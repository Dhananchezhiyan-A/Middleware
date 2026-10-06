import { createZodDto } from "nestjs-zod";
import { cursorQuerySchema, userCreateSchema, userUpdateSchema } from "@middleware/validation";

/** Cursor pagination query shared by list endpoints. */
export class UserListQueryDto extends createZodDto(cursorQuerySchema) {}
export class CreateUserDto extends createZodDto(userCreateSchema) {}
export class UpdateUserDto extends createZodDto(userUpdateSchema) {}
