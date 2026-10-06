import { createZodDto } from "nestjs-zod";
import { loginSchema, refreshSchema } from "@middleware/validation";

/**
 * Request DTOs — Zod schemas are SHARED with the web app and any other
 * client via @middleware/validation (single source of truth).
 */
export class LoginDto extends createZodDto(loginSchema) {}
export class RefreshDto extends createZodDto(refreshSchema) {}
