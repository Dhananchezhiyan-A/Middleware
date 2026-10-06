import { Module } from "@nestjs/common";
import { QueueProducerModule } from "./queues/queue-producer";
import { PipelineService } from "./pipeline/pipeline.service";
import { DeliveryService } from "./delivery/delivery.service";
import { IntakeProcessor } from "./processors/intake.processor";
import { PipelineProcessor } from "./processors/pipeline.processor";
import { ReplayProcessor } from "./processors/replay.processor";
import { CsvImportProcessor } from "./processors/csv-import.processor";
import { WorkersService } from "./workers/workers.service";

/**
 * Worker application module — no HTTP surface, only queue consumers.
 *
 * Queue topology (see @middleware/types QUEUES):
 *   lead-intake      → confirm + chain pipeline (idempotent)
 *   lead-processing  → validation → normalization → dedup → enrichment →
 *                      scoring → routing → mapping → delivery fan-out
 *   enrichment/scoring/routing → single-stage re-runs
 *   delivery         → adapter attempts with retries/backoff/DLQ
 *   retry            → audited delivery replay + periodic crash-recovery sweep
 *   csv-import       → file parsing + lead creation (idempotent rows)
 */
@Module({
  imports: [QueueProducerModule],
  providers: [
    PipelineService,
    DeliveryService,
    IntakeProcessor,
    PipelineProcessor,
    ReplayProcessor,
    CsvImportProcessor,
    WorkersService,
  ],
})
export class AppModule {}
