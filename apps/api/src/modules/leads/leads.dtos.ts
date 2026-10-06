import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { cursorQuerySchema, leadListQuerySchema, idSchema } from "@middleware/validation";

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
