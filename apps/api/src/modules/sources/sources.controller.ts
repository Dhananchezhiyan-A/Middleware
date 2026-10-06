import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import {
  CreateSourceAccountDto,
  CreateSourceDto,
  UpdateSourceAccountDto,
  UpdateSourceDto,
} from "./sources.dtos";
import { SourcesService } from "./sources.service";

@ApiTags("sources")
@Controller("sources")
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  @RequirePermission("sources:read")
  @ApiOperation({ summary: "List lead sources with account/lead counts" })
  list() {
    return this.sources.listSources();
  }

  @Post()
  @RequirePermission("sources:write")
  @ApiOperation({ summary: "Create a lead source" })
  create(@CurrentUser() actor: RequestActor, @Body() body: CreateSourceDto) {
    return this.sources.createSource(actor, body);
  }

  @Get(":id")
  @RequirePermission("sources:read")
  @ApiOperation({ summary: "Source detail with its inbound accounts" })
  get(@Param("id") id: string) {
    return this.sources.getSource(id);
  }

  @Patch(":id")
  @RequirePermission("sources:write")
  @ApiOperation({ summary: "Update a lead source" })
  update(@CurrentUser() actor: RequestActor, @Param("id") id: string, @Body() body: UpdateSourceDto) {
    return this.sources.updateSource(actor, id, body);
  }

  @Delete(":id")
  @RequirePermission("sources:write")
  @ApiOperation({ summary: "Delete a source (blocked while leads exist)" })
  remove(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.sources.deleteSource(actor, id);
  }

  // --- Accounts ----------------------------------------------------------------

  @Get(":id/accounts")
  @RequirePermission("sources:read")
  @ApiOperation({ summary: "List inbound accounts (with webhook URLs)" })
  listAccounts(@Param("id") id: string) {
    return this.sources.listAccounts(id);
  }

  @Post(":id/accounts")
  @RequirePermission("sources:write")
  @ApiOperation({ summary: "Create an inbound account and public webhook URL" })
  createAccount(
    @CurrentUser() actor: RequestActor,
    @Param("id") id: string,
    @Body() body: CreateSourceAccountDto,
  ) {
    return this.sources.createAccount(actor, id, body);
  }

  @Patch("accounts/:accountId")
  @RequirePermission("sources:write")
  @ApiOperation({ summary: "Update an inbound account" })
  updateAccount(
    @CurrentUser() actor: RequestActor,
    @Param("accountId") accountId: string,
    @Body() body: UpdateSourceAccountDto,
  ) {
    return this.sources.updateAccount(actor, accountId, body);
  }

  @Delete("accounts/:accountId")
  @RequirePermission("sources:write")
  @ApiOperation({ summary: "Delete an inbound account (blocked while leads exist)" })
  removeAccount(@CurrentUser() actor: RequestActor, @Param("accountId") accountId: string) {
    return this.sources.deleteAccount(actor, accountId);
  }

  @Post("accounts/:accountId/rotate-secret")
  @RequirePermission("sources:write")
  @ApiOperation({ summary: "Rotate the webhook signing secret (returned ONCE)" })
  rotateSecret(@CurrentUser() actor: RequestActor, @Param("accountId") accountId: string) {
    return this.sources.rotateSecret(actor, accountId);
  }
}
