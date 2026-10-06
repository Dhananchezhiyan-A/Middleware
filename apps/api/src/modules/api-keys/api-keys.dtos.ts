import { createZodDto } from "nestjs-zod";
import { apiKeyCreateSchema, cursorQuerySchema } from "@middleware/validation";

/** Cursor pagination query shared by list endpoints. */
export class ApiKeyListQueryDto extends createZodDto(cursorQuerySchema) {}
export class CreateApiKeyDto extends createZodDto(apiKeyCreateSchema) {}
