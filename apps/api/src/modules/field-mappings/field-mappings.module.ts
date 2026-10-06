import { Module } from "@nestjs/common";
import { FieldMappingsController } from "./field-mappings.controller";
import { FieldMappingsService } from "./field-mappings.service";

@Module({
  controllers: [FieldMappingsController],
  providers: [FieldMappingsService],
})
export class FieldMappingsModule {}
