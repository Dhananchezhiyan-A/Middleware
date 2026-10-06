import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { getPrisma } from "@middleware/database";
import { getEnv } from "@middleware/config";
import { json } from "../common/json";
import { QueueProducer } from "../queues/queue-producer";

/**
 * RETRY / REPLAY_DELIVERY: explicit, audited replay of a terminal delivery.
 *
 * ATTEMPT NUMBERING MODEL (global, never reset):
 *  - Delivery.attemptCount is a monotonic lifetime counter (1..5, 6..10, …).
 *    Replay does NOT touch it, so historical DeliveryAttempt rows keep their
 *    numbers and the unique (delivery, attemptNumber) constraint can
 *    never collide — every real attempt gets its own immutable row.
 *  - Replay starts a NEW cycle: replayCount++ , cycleStartAttempt =
 *    attemptCount + 1, and maxAttempts is extended by the configured cycle
 *    size so the cycle gets a full set of attempts.
 *  - DeliveryAttempt rows are append-only; nothing is deleted or renumbered.
 *  - A fresh delivery job is enqueued (fresh jobId so completed-job dedupe
 *    cannot swallow it), which also restarts the BullMQ backoff ladder.
 */
@Injectable()
export class ReplayProcessor {
  private readonly logger = new Logger(ReplayProcessor.name);

  constructor(private readonly queues: QueueProducer) {}

  async process(
    job: Job<{ deliveryId: string; requestedBy: string; correlationId: string }>,
  ): Promise<void> {
    const db = getPrisma();
    const { deliveryId, requestedBy, correlationId } = job.data;

    const delivery = await db.delivery.findFirst({
      where: { id: deliveryId },
      include: { destination: true },
    });
    if (!delivery) {
      throw new UnrecoverableError(`Delivery ${deliveryId} not found`);
    }

    if (["PENDING", "QUEUED", "IN_PROGRESS"].includes(delivery.status)) {
      // Already in flight — re-enqueue rather than reset (no attempt loss).
      this.logger.warn(`Replay of active delivery ${deliveryId}; re-enqueueing instead of reset.`);
      await this.queues.enqueueDeliveryFresh({
        deliveryId,
        leadId: delivery.leadId,
        destinationId: delivery.destinationId,
        correlationId,
      });
      return;
    }

    const cycleSize = getEnv().DELIVERY_MAX_ATTEMPTS;
    const nextCycle = delivery.replayCount + 1;
    const resumesAtAttempt = delivery.attemptCount + 1;
    const nextMaxAttempts = delivery.maxAttempts + cycleSize;

    await db.delivery.update({
      where: { id: deliveryId },
      data: {
        status: "QUEUED",
        // attemptCount is intentionally NOT reset — global numbering continues
        // at attemptCount + 1 (e.g. 6 after a 5-attempt original cycle).
        replayCount: nextCycle,
        cycleStartAttempt: resumesAtAttempt,
        maxAttempts: nextMaxAttempts,
        nextAttemptAt: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        enqueuedAt: new Date(),
        correlationId,
      },
    });

    await db.auditLog.create({
      data: {
        actorType: "USER",
        actorId: requestedBy,
        actorLabel: `replay requested by ${requestedBy}`,
        action: "delivery.replayed",
        entityType: "Delivery",
        entityId: deliveryId,
        correlationId,
        metadata: json({
          destinationId: delivery.destinationId,
          previousStatus: delivery.status,
          replayCycle: nextCycle,
          previousAttempts: delivery.attemptCount,
          resumesAtAttempt,
          cycleMaxAttempts: nextMaxAttempts,
        }),
      },
    });

    await this.queues.enqueueDeliveryFresh({
      deliveryId,
      leadId: delivery.leadId,
      destinationId: delivery.destinationId,
      correlationId,
    });
    this.logger.log(
      `Delivery ${deliveryId} replay cycle ${nextCycle} queued by ${requestedBy} (attempts resume at ${resumesAtAttempt}).`,
    );
  }
}
