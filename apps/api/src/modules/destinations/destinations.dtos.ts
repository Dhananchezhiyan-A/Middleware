import { createZodDto } from "nestjs-zod";
import {
  credentialSetSchema,
  destinationCreateSchema,
  destinationUpdateSchema,
} from "@middleware/validation";

export class CreateDestinationDto extends createZodDto(destinationCreateSchema) {}
export class UpdateDestinationDto extends createZodDto(destinationUpdateSchema) {}
export class SetCredentialDto extends createZodDto(credentialSetSchema) {}
