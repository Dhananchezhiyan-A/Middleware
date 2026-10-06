import { createZodDto } from "nestjs-zod";
import { roleUpsertSchema } from "@middleware/validation";

export class CreateRoleDto extends createZodDto(roleUpsertSchema) {}
/** PATCH accepts any subset of the upsert fields. */
export class UpdateRoleDto extends createZodDto(roleUpsertSchema.partial()) {}
