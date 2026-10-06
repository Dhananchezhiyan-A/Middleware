import { createZodDto } from "nestjs-zod";
import { auditListQuerySchema } from "@middleware/validation";

/** Filters: cursor, limit, action, entityType, entityId, actorId, from, to. */
export class AuditLogQueryDto extends createZodDto(auditListQuerySchema) {}
