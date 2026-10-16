import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { idSchema, importListQuerySchema } from "@middleware/validation";
import type { CsvColumnMapping } from "@middleware/types";

/** Filters: cursor, limit, status, from, to. */
export class ImportListQueryDto extends createZodDto(importListQuerySchema) {}

/** One entry of the column mapping (multipart fields arrive as strings). */
const csvColumnMappingSchema = z.object({
  column: z.string().min(1).max(255),
  target: z.string().max(255),
});

/**
 * Multipart bodies are NOT piped through DTOs by the global validation pipes,
 * so the text fields are parsed manually with this schema inside the
 * controller. `sourceId` is REQUIRED: an import always belongs to a source
 * and one of its accounts (the worker refuses to run without them).
 */
export const importUploadSchema = z.object({
  sourceId: idSchema,
  sourceAccountId: idSchema.optional(),
  /** JSON-encoded `CsvColumnMapping[]` chosen in the upload UI. */
  mapping: z
    .string()
    .max(200_000)
    .optional()
    .transform((value, ctx): CsvColumnMapping[] | undefined => {
      if (value === undefined || value.trim() === "") return undefined;
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "mapping must be a JSON array." });
        return z.NEVER;
      }
      const result = z.array(csvColumnMappingSchema).safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({ code: "custom", message: "mapping must be an array of {column, target}." });
        return z.NEVER;
      }
      return result.data;
    }),
});

/** In-memory multer upload (multer keeps the bytes in a Buffer). */
export interface UploadedCsvFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ImportUploadInput {
  sourceId: string;
  sourceAccountId?: string;
  mapping?: CsvColumnMapping[];
}

/** Row-error page returned by `GET /imports/:id/row-errors`. */
export interface ImportRowErrorView {
  rowNumber: number;
  error: string;
  rawRow: unknown;
}
