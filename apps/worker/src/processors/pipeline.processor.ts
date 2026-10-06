import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { getPrisma } from "@middleware/database";
import type { LeadProcessingJob } from "@middleware/types";
import { PipelineService } from "../pipeline/pipeline.service";

/**
 * LEAD_PROCESSING: runs the full stage pipeline, plus the single-stage
 * re-run jobs (ENRICHMENT/SCORING/ROUTING queues share this processor).
 *
 * Failure policy:
 *  - Infrastructure errors → rethrow (BullMQ retries with backoff; on the
 *    last attempt the lead is terminally FAILED so no lead is ever stuck).
 *  - Permanent errors (missing lead) → UnrecoverableError → DLQ.
 *  - Business outcomes (rejected/duplicate/no destination) are successes.
 */
@Injectable()
export class PipelineProcessor {
  private readonly logger = new Logger(PipelineProcessor.name);

  constructor(private readonly pipeline: PipelineService) {}

  async process(job: Job<LeadProcessingJob>): Promise<void> {
    try {
      const result = await this.pipeline.processLead(job.data);
      this.logger.log(
        `Lead ${job.data.leadId}: ${result.outcome} (${result.deliveries} delivery/deliveries)`,
      );
    } catch (err) {
      await this.markLeadFailedIfPermanent(job, err);
      throw err;
    }
  }

  /** Single-stage jobs: job.name decides which stage runs. */
  async processStage(
    job: Job<{ leadId: string; correlationId: string }>,
    stage: "ENRICHMENT" | "SCORING" | "ROUTING",
  ): Promise<void> {
    try {
      await this.pipeline.runSingleStage(job.data, stage);
    } catch (err) {
      await this.markLeadFailedIfPermanent(job, err);
      throw err;
    }
  }

  private async markLeadFailedIfPermanent(job: Job<unknown>, err: unknown): Promise<void> {
    const permanent =
      err instanceof UnrecoverableError || (err as Error | undefined)?.name === "UnrecoverableError";
    const attemptsAllowed = job.opts.attempts ?? 1;
    const lastAttempt = job.attemptsMade + 1 >= attemptsAllowed;
    if (!permanent && !lastAttempt) return;

    const leadId = (job.data as { leadId?: string } | undefined)?.leadId;
    if (!leadId) return;

    const message = err instanceof Error ? err.message : String(err);
    const db = getPrisma();
    try {
      await db.lead.updateMany({
        where: { id: leadId, stage: { notIn: ["COMPLETED", "FAILED"] } },
        data: { status: "FAILED", stage: "FAILED" },
      });
      await db.leadProcessing.updateMany({
        where: { leadId, finishedAt: null },
        data: { finishedAt: new Date(), error: message.slice(0, 2000) },
      });
      this.logger.error(`Lead ${leadId} terminally failed after pipeline error: ${message}`);
    } catch (dbErr) {
      this.logger.error(`Could not mark lead ${leadId} failed: ${String(dbErr)}`);
    }
  }
}
