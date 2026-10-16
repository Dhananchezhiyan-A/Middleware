import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  cursorQuerySchema,
  leadListQuerySchema,
  leadFilterQuerySchema,
  idSchema,
} from "@middleware/validation";

export class LeadListQueryDto extends createZodDto(leadListQuerySchema) {}

/** Manual lead creation through the API (must reference an existing source). */
const leadCreateSchema = z.object({
  sourceId: idSchema,
  sourceAccountId: idSchema,
  externalLeadId: z.string().min(1).max(200).optional(),
  data: z.record(z.string(), z.unknown()),
});
export class CreateLeadDto extends createZodDto(leadCreateSchema) {}

export class TimelineQueryDto extends createZodDto(cursorQuerySchema) {}

/**
 * `POST /leads/selection` — the same filter criteria `GET /leads` accepts,
 * resolved server-side into an expiring all-filtered selection snapshot.
 */
export class CreateSelectionDto extends createZodDto(leadFilterQuerySchema) {}

/**
 * `POST /leads/manual-send[/preview]` — either an opaque selection token
 * (all-filtered) or an explicit bounded lead ID list (current page).
 * Emptiness/ownership/limits are revalidated server-side in the service.
 */
const manualSendSchema = z.object({
  selectionToken: z.string().max(128).optional(),
  leadIds: z.array(idSchema).max(100_000).optional(),
  destinationIds: z.array(idSchema).min(1).max(1000),
});
export class ManualSendDto extends createZodDto(manualSendSchema) {}
