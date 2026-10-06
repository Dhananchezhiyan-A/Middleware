import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { getPrisma } from "@middleware/database";
import {
  createDefaultRegistry,
  type CredentialContext,
  type DeliveryRequest,
  type DeliveryResult,
  type DestinationContext,
} from "@middleware/integrations";
import { decryptSecret, isAppError, getContext } from "@middleware/shared";
import { backoffDelayMs, type DeliverJob } from "@middleware/types";
import { json, fromJson } from "../common/json";
import { PipelineService } from "../pipeline/pipeline.service";

/**
 * Delivery worker — one external call per attempt, with complete evidence.
 *
 * Guarantees:
 *  - Exactly one in-flight attempt per delivery (CAS claim on attemptCount).
 *  - Every attempt is recorded as an immutable DeliveryAttempt row.
 *  - Retries: BullMQ exponential backoff (custom strategy honors Retry-After),
 *    capped by BOTH delivery.maxAttempts (DB) and queue attempts (Redis).
 *  - Terminal failures are marked FAILED (non-retryable) or DEAD (exhausted)
 *    and the job is dead-lettered — never silently dropped.
 *  - DestinationHealth only reflects real probe/attempt results.
 */

/** Retryable failure carrying a destination-provided Retry-After hint. */
export class DeliveryRetryError extends Error {
  readonly retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "DeliveryRetryError";
    this.retryAfterMs = retryAfterMs;
  }
}

const WORKER_ID = `${process.env.HOSTNAME ?? "worker"}:${process.pid}`;

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
  private readonly registry = createDefaultRegistry();

  constructor(private readonly pipeline: PipelineService) {}

  async attempt(job: Job<DeliverJob>): Promise<void> {
    const db = getPrisma();
    const { deliveryId, correlationId } = job.data;

    const delivery = await db.delivery.findFirst({
      where: { id: deliveryId },
      include: { destination: true, lead: true },
    });
    if (!delivery) {
      throw new UnrecoverableError(`Delivery ${deliveryId} not found`);
    }
    // Idempotency: terminal deliveries are only changed by explicit replay.
    if (delivery.status === "SUCCEEDED" || delivery.status === "FAILED" || delivery.status === "DEAD") {
      this.logger.warn(
        `Skipping delivery ${deliveryId} in terminal state ${delivery.status} (stale job)`,
      );
      return;
    }

    // Global attempt cap (independent of queue-level attempts). attemptCount is
    // a lifetime counter: a replay extends maxAttempts instead of resetting it.
    if (delivery.attemptCount >= delivery.maxAttempts) {
      await this.finalizeDead(delivery.id, "DELIVERY_DEAD", "Delivery attempts exhausted.", correlationId);
      throw new UnrecoverableError(`Delivery ${deliveryId} exhausted ${delivery.maxAttempts} attempts`);
    }

    // Atomic claim — exactly one worker may own this attempt. attemptNumber is
    // GLOBAL per delivery (1..5, then 6..10 after a replay) so it never
    // collides with immutable history.
    const attemptNumber = delivery.attemptCount + 1;
    const claim = await db.delivery.updateMany({
      where: {
        id: deliveryId,
        attemptCount: delivery.attemptCount,
        status: { in: ["PENDING", "QUEUED", "IN_PROGRESS"] },
      },
      data: { status: "IN_PROGRESS", attemptCount: { increment: 1 } },
    });
    if (claim.count === 0) {
      this.logger.warn(`Delivery ${deliveryId} attempt ${attemptNumber} already claimed; skipping.`);
      return;
    }

    const startedAt = new Date();
    const started = Date.now();

    // --- Build the request ---------------------------------------------------
    const destination: DestinationContext = {
      id: delivery.destination.id,
      type: delivery.destination.type,
      name: delivery.destination.name,
      config: fromJson<Record<string, unknown>>(delivery.destination.config ?? {}),
      rateLimitPerSec: delivery.destination.rateLimitPerSec,
    };

    let credential: CredentialContext | undefined;
    const credRow = await db.integrationCredential.findFirst({
      where: { destinationId: destination.id },
    });
    if (credRow) {
      credential = {
        type: credRow.type,
        secret: decryptSecret(credRow.secret),
        meta: fromJson<Record<string, unknown>>(credRow.meta ?? {}),
      };
    }

    const canonical = fromJson<DeliveryRequest["lead"]["canonical"]>(delivery.lead.canonicalData ?? {});
    const request: DeliveryRequest = {
      destination,
      credential,
      lead: {
        id: delivery.leadId,
        externalLeadId: delivery.lead.externalLeadId,
        canonical,
      },
      mappedPayload: fromJson<Record<string, unknown>>(delivery.mappedPayload ?? {}),
      correlationId: correlationId ?? getContext()?.correlationId ?? "unknown",
      attempt: attemptNumber,
      idempotencyKey: `${delivery.leadId}|${destination.id}`,
    };

    // --- Execute -------------------------------------------------------------
    let result: DeliveryResult;
    try {
      const adapter = this.registry.get(destination.type);
      const missing = adapter.validate(destination, credential);
      if (missing.length > 0) {
        result = {
          success: false,
          errorCode: "DESTINATION_NOT_CONFIGURED",
          errorMessage: `Destination is not configured. Missing: ${missing.join(", ")}`,
          retryable: false,
          durationMs: Date.now() - started,
        };
      } else {
        result = await adapter.deliver(request);
      }
    } catch (err) {
      // Adapter contract says deliver() never throws — if one does, treat it
      // as a transport failure (retryable), never as a success.
      if (isAppError(err)) {
        result = {
          success: false,
          errorCode: err.code,
          errorMessage: err.message,
          retryable: err.retryable || err.code === "DESTINATION_TIMEOUT",
          durationMs: Date.now() - started,
        };
      } else {
        result = {
          success: false,
          errorCode: "DESTINATION_UNREACHABLE",
          errorMessage: "Destination call failed unexpectedly.",
          retryable: true,
          durationMs: Date.now() - started,
        };
      }
    }

    // --- Record the attempt (immutable evidence) -----------------------------
    await this.recordAttempt({
      deliveryId,
      attemptNumber,
      replayCycle: delivery.replayCount,
      result,
      startedAt,
      requestUrl: result.requestUrl,
      idempotencyKey: request.idempotencyKey,
    });

    if (result.success) {
      await db.delivery.update({
        where: { id: deliveryId },
        data: {
          status: "SUCCEEDED",
          externalId: result.externalId ?? delivery.externalId ?? null,
          completedAt: new Date(),
          nextAttemptAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      await this.updateHealth(destination.id, true, result.durationMs, undefined);
      // Terminal SUCCESS must be audited exactly like terminal failure —
      // a delivered lead is THE key event of this system.
      await this.audit("delivery.succeeded", deliveryId, correlationId, {
        destinationId: destination.id,
        attempts: attemptNumber,
        durationMs: result.durationMs,
        externalId: result.externalId ?? null,
      });
      await this.pipeline.finalizeLeadIfDone(delivery.leadId, request.correlationId);
      return;
    }

    // --- Failure: retry or terminate ----------------------------------------
    const queueAttemptsAllowed = job.opts.attempts ?? 1;
    const queueAttemptsLeft = queueAttemptsAllowed - (job.attemptsMade + 1);
    const willRetry =
      result.retryable && attemptNumber < delivery.maxAttempts && queueAttemptsLeft > 0;

    await this.updateHealth(
      destination.id,
      false,
      result.durationMs,
      result.errorMessage ?? result.errorCode ?? "delivery failed",
    );

    if (willRetry) {
      // Backoff ladder is cycle-local (attempt 6 waits like attempt 1 of the
      // replay cycle) while attempt numbers stay global.
      const cycleLocalAttempt = attemptNumber - delivery.cycleStartAttempt + 1;
      const delay = Math.max(result.retryAfterMs ?? 0, backoffDelayMs(cycleLocalAttempt));
      await db.delivery.update({
        where: { id: deliveryId },
        data: {
          status: "QUEUED",
          nextAttemptAt: new Date(Date.now() + delay),
          errorCode: result.errorCode ?? null,
          errorMessage: (result.errorMessage ?? null)?.slice(0, 2000) ?? null,
        },
      });
      throw new DeliveryRetryError(
        `Attempt ${attemptNumber} failed: ${result.errorMessage ?? result.errorCode ?? "unknown error"}`,
        result.retryAfterMs,
      );
    }

    const terminalStatus = result.retryable ? "DEAD" : "FAILED";
    await db.delivery.update({
      where: { id: deliveryId },
      data: {
        status: terminalStatus,
        completedAt: new Date(),
        nextAttemptAt: null,
        errorCode: result.errorCode ?? null,
        errorMessage: (result.errorMessage ?? null)?.slice(0, 2000) ?? null,
      },
    });
    await this.audit(`delivery.${terminalStatus.toLowerCase()}`, deliveryId, correlationId, {
      destinationId: destination.id,
      attempts: attemptNumber,
      errorCode: result.errorCode ?? null,
      retryable: result.retryable,
    });
    await this.pipeline.finalizeLeadIfDone(delivery.leadId, request.correlationId);

    // Unrecoverable → BullMQ moves the job to failed immediately → DLQ.
    throw new UnrecoverableError(
      `Delivery ${deliveryId} ${terminalStatus}: ${result.errorMessage ?? result.errorCode ?? "unknown error"}`,
    );
  }

  /** Called by the sweeper when a delivery has been IN_PROGRESS too long. */
  async releaseStaleDelivery(deliveryId: string): Promise<boolean> {
    const db = getPrisma();
    const res = await db.delivery.updateMany({
      where: { id: deliveryId, status: "IN_PROGRESS" },
      data: { status: "QUEUED", nextAttemptAt: new Date() },
    });
    return res.count > 0;
  }

  // ===========================================================================

  private async recordAttempt(args: {
    deliveryId: string;
    attemptNumber: number;
    replayCycle: number;
    result: DeliveryResult;
    startedAt: Date;
    requestUrl?: string;
    idempotencyKey: string;
  }): Promise<void> {
    const db = getPrisma();
    const { result } = args;
    const status = !result.success
      ? result.errorCode === "DESTINATION_TIMEOUT"
        ? "TIMEOUT"
        : result.rateLimited
          ? "RATE_LIMITED"
          : result.errorCode === "DESTINATION_NOT_CONFIGURED"
            ? "NOT_CONFIGURED"
            : "FAILED"
      : "SUCCEEDED";

    try {
      await db.deliveryAttempt.create({
        data: {
          deliveryId: args.deliveryId,
          attemptNumber: args.attemptNumber,
          replayCycle: args.replayCycle,
          status,
          responseStatus: result.responseStatus ?? null,
          responseBody: result.responseBody ?? null,
          errorCode: result.errorCode ?? null,
          errorCategory: categorize(result),
          durationMs: result.durationMs,
          externalId: result.externalId ?? null,
          requestMeta: json({
            requestUrl: args.requestUrl ?? null,
            idempotencyKey: args.idempotencyKey,
            rateLimited: result.rateLimited ?? false,
            retryAfterMs: result.retryAfterMs ?? null,
          }),
          startedAt: args.startedAt,
          finishedAt: new Date(),
          workerId: WORKER_ID,
        },
      });
    } catch (err) {
      // INVARIANT: attempt numbers are global per delivery (replay extends the
      // cycle instead of resetting the counter), so a unique
      // (delivery, attemptNumber) violation can only be a bug. Never
      // overwrite the existing row — surface it loudly instead.
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
      this.logger.error(
        `INVARIANT VIOLATION: attempt ${args.attemptNumber} for delivery ${args.deliveryId} already exists — ` +
          `attempt numbering collided with immutable history; replay must never reset attemptCount.`,
      );
    }
  }

  private async finalizeDead(
    deliveryId: string,
    errorCode: string,
    message: string,
    correlationId?: string,
  ): Promise<void> {
    const db = getPrisma();
    await db.delivery.updateMany({
      where: { id: deliveryId, status: { in: ["PENDING", "QUEUED", "IN_PROGRESS"] } },
      data: {
        status: "DEAD",
        completedAt: new Date(),
        nextAttemptAt: null,
        errorCode,
        errorMessage: message.slice(0, 2000),
      },
    });
    await this.audit("delivery.dead", deliveryId, correlationId, { reason: message });
  }

  private async updateHealth(
    destinationId: string,
    ok: boolean,
    latencyMs: number,
    error: string | undefined,
  ): Promise<void> {
    const db = getPrisma();
    const now = new Date();
    try {
      await db.destinationHealth.upsert({
        where: { destinationId },
        create: {
          destinationId,
          status: ok ? "CONNECTED" : "ERROR",
          lastSuccessAt: ok ? now : null,
          lastFailureAt: ok ? null : now,
          lastError: ok ? null : (error ?? "unknown").slice(0, 2000),
          lastLatencyMs: latencyMs,
          checkedAt: now,
        },
        update: {
          status: ok ? "CONNECTED" : "ERROR",
          ...(ok ? { lastSuccessAt: now } : { lastFailureAt: now }),
          lastError: ok ? null : (error ?? "unknown").slice(0, 2000),
          lastLatencyMs: latencyMs,
          checkedAt: now,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to update destination health for ${destinationId}: ${String(err)}`);
    }
  }

  private async audit(
    action: string,
    entityId: string,
    correlationId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const db = getPrisma();
    try {
      await db.auditLog.create({
        data: {
          actorType: "WORKER",
          actorLabel: `delivery-worker (${WORKER_ID})`,
          action,
          entityType: "Delivery",
          entityId,
          correlationId: correlationId ?? null,
          metadata: json(metadata),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log ${action}/${entityId}: ${String(err)}`);
    }
  }
}

function categorize(result: DeliveryResult): string {
  const code = result.errorCode ?? "";
  if (result.rateLimited) return "rate_limit";
  if (code.includes("TIMEOUT")) return "timeout";
  if (code.includes("AUTH")) return "auth";
  if (code.includes("SSRF")) return "ssrf";
  if (code.includes("NOT_CONFIGURED")) return "not_configured";
  if (code.includes("UNREACHABLE") || code.includes("SERVER_ERROR")) return "transport";
  if (code.includes("REJECTED")) return "rejected";
  return "unknown";
}

export { WORKER_ID };
