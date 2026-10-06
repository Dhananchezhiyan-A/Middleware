import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { getPrisma } from "@middleware/database";
import type { LeadIntakeJob } from "@middleware/types";
import { QueueProducer } from "../queues/queue-producer";

/**
 * LEAD_INTAKE: first queue hop after persistence. Confirms the lead exists,
 * prepares its processing row, then chains the pipeline job.
 *
 * Idempotent: jobId = `intake:${leadId}` collapses provider retries; the
 * pipeline job it enqueues is idempotent by design.
 */
@Injectable()
export class IntakeProcessor {
  private readonly logger = new Logger(IntakeProcessor.name);

  constructor(private readonly queues: QueueProducer) {}

  async process(job: Job<LeadIntakeJob>): Promise<void> {
    const db = getPrisma();
    const { leadId, correlationId } = job.data;

    const lead = await db.lead.findFirst({ where: { id: leadId } });
    if (!lead) {
      // Permanent: the lead row was deleted before processing; never retry.
      throw new UnrecoverableError(`Lead ${leadId} not found`);
    }

    await db.leadProcessing.upsert({
      where: { leadId },
      create: { leadId, correlationId, startedAt: new Date() },
      update: {},
    });

    // Re-intake of an already-finalized lead only re-enters the pipeline via
    // an explicit replay (fresh pipeline jobId) — normal intake never
    // downgrades a terminal lead.
    if (lead.status === "RECEIVED") {
      await db.lead.update({ where: { id: leadId }, data: { status: "PROCESSING" } });
    }

    await this.queues.enqueuePipeline({ leadId, correlationId });
    this.logger.log(`Intake complete for lead ${leadId}; pipeline queued.`);
  }
}
