import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { CreateRoutingRuleDto, UpdateRoutingRuleDto } from "./routing-rules.dtos";
import { RoutingRulesService } from "./routing-rules.service";

@ApiTags("routing-rules")
@Controller("routing-rules")
export class RoutingRulesController {
  constructor(private readonly rules: RoutingRulesService) {}

  @Get()
  @RequirePermission("routing:read")
  @ApiOperation({ summary: "List routing rules ordered by priority" })
  async list() {
    return this.rules.listRules();
  }

  @Post()
  @RequirePermission("routing:write")
  @ApiOperation({ summary: "Create a routing rule with its ordered destinations" })
  async create(@CurrentUser() actor: RequestActor, @Body() body: CreateRoutingRuleDto) {
    return this.rules.createRule(actor, body);
  }

  @Patch(":id")
  @RequirePermission("routing:write")
  @ApiOperation({ summary: "Update a routing rule (bumps its version)" })
  async update(
    @CurrentUser() actor: RequestActor,
    @Param("id") id: string,
    @Body() body: UpdateRoutingRuleDto,
  ) {
    return this.rules.updateRule(actor, id, body);
  }

  @Delete(":id")
  @RequirePermission("routing:write")
  @ApiOperation({ summary: "Delete a routing rule" })
  async remove(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.rules.deleteRule(actor, id);
  }
}
