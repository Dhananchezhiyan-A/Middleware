import { createZodDto } from "nestjs-zod";
import {
  sourceCreateSchema,
  sourceUpdateSchema,
  sourceAccountCreateSchema,
} from "@middleware/validation";

export class CreateSourceDto extends createZodDto(sourceCreateSchema) {}
export class UpdateSourceDto extends createZodDto(sourceUpdateSchema) {}

const accountUpdateSchema = sourceAccountCreateSchema.omit({ sourceId: true }).partial();
export class UpdateSourceAccountDto extends createZodDto(accountUpdateSchema) {}

const accountCreateBodySchema = sourceAccountCreateSchema.omit({ sourceId: true });
export class CreateSourceAccountDto extends createZodDto(accountCreateBodySchema) {}
