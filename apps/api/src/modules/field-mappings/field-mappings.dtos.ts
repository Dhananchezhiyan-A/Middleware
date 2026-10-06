import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  cursorQuerySchema,
  fieldMappingCreateSchema,
  fieldMappingVersionSchema,
  idSchema,
} from "@middleware/validation";

const fieldMappingListQuerySchema = cursorQuerySchema.extend({
  destinationId: idSchema.optional(),
});

/** POST /field-mappings/:id/activate body — activate an existing version. */
const fieldMappingActivateSchema = z.object({
  version: z.coerce.number().int().min(1),
});

export class FieldMappingListQueryDto extends createZodDto(fieldMappingListQuerySchema) {}
export class CreateFieldMappingDto extends createZodDto(fieldMappingCreateSchema) {}
export class CreateFieldMappingVersionDto extends createZodDto(fieldMappingVersionSchema) {}
export class ActivateFieldMappingDto extends createZodDto(fieldMappingActivateSchema) {}
