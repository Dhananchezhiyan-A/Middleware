import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { idSchema, importListQuerySchema } from "@middleware/validation";

/** Filters: cursor, limit, status, from, to. */
export class ImportListQueryDto extends createZodDto(importListQuerySchema) {}

/**
 * Multipart bodies are NOT piped through DTOs by the global validation pipes,
 * so the optional `sourceId` text field is parsed manually with this schema
 * inside the controller.
 */
export const importUploadSchema = z.object({
  sourceId: idSchema.optional(),
});

/** In-memory multer upload (multer keeps the bytes in a Buffer). */
export interface UploadedCsvFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
