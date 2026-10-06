import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import {
  ActivateFieldMappingDto,
  CreateFieldMappingDto,
  CreateFieldMappingVersionDto,
  FieldMappingListQueryDto,
} from "./field-mappings.dtos";
import { FieldMappingsService } from "./field-mappings.service";

@ApiTags("field-mappings")
@Controller("field-mappings")
export class FieldMappingsController {
  constructor(private readonly mappings: FieldMappingsService) {}

  @Get()
  @RequirePermission("mappings:read")
  @ApiOperation({ summary: "List field mappings (optionally filtered by destination)" })
  async list(@CurrentUser() actor: RequestActor, @Query() query: FieldMappingListQueryDto) {
    return this.mappings.listFieldMappings(actor, query);
  }

  @Get(":id")
  @RequirePermission("mappings:read")
  @ApiOperation({ summary: "Get a field mapping with all of its versions (newest first)" })
  async get(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.mappings.getFieldMapping(actor, id);
  }

  @Post()
  @RequirePermission("mappings:write")
  @ApiOperation({ summary: "Create a field mapping with version 1" })
  async create(@CurrentUser() actor: RequestActor, @Body() body: CreateFieldMappingDto) {
    return this.mappings.createFieldMapping(actor, body);
  }

  @Post(":id/versions")
  @RequirePermission("mappings:write")
  @ApiOperation({ summary: "Append a new version to a field mapping" })
  async createVersion(
    @CurrentUser() actor: RequestActor,
    @Param("id") id: string,
    @Body() body: CreateFieldMappingVersionDto,
  ) {
    return this.mappings.createVersion(actor, id, body);
  }

  @Post(":id/activate")
  @RequirePermission("mappings:write")
  @ApiOperation({ summary: "Activate an existing version of a field mapping" })
  async activate(
    @CurrentUser() actor: RequestActor,
    @Param("id") id: string,
    @Body() body: ActivateFieldMappingDto,
  ) {
    return this.mappings.activateVersion(actor, id, body);
  }

  @Delete(":id")
  @RequirePermission("mappings:write")
  @ApiOperation({ summary: "Delete a field mapping" })
  async remove(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.mappings.deleteFieldMapping(actor, id);
  }
}
