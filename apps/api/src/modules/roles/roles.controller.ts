import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { CreateRoleDto, UpdateRoleDto } from "./roles.dtos";
import { RolesService } from "./roles.service";

@ApiTags("roles")
@Controller("roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission("roles:read")
  @ApiOperation({ summary: "List application roles" })
  async list() {
    return this.roles.listRoles();
  }

  @Get("permissions")
  @RequirePermission("roles:read")
  @ApiOperation({ summary: "Static permission catalog and role templates (fixed reference data)" })
  async permissions() {
    return this.roles.getPermissionCatalog();
  }

  @Post()
  @RequirePermission("roles:write")
  @ApiOperation({ summary: "Create a custom role" })
  async create(@CurrentUser() actor: RequestActor, @Body() body: CreateRoleDto) {
    return this.roles.createRole(actor, body);
  }

  @Patch(":id")
  @RequirePermission("roles:write")
  @ApiOperation({ summary: "Update a custom role (system roles are immutable)" })
  async update(
    @CurrentUser() actor: RequestActor,
    @Param("id") id: string,
    @Body() body: UpdateRoleDto,
  ) {
    return this.roles.updateRole(actor, id, body);
  }

  @Delete(":id")
  @RequirePermission("roles:write")
  @ApiOperation({ summary: "Delete a custom role (fails while users are assigned)" })
  async remove(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.roles.deleteRole(actor, id);
  }
}
