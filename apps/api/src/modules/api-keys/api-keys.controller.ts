import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { ApiKeyListQueryDto, CreateApiKeyDto } from "./api-keys.dtos";
import { ApiKeysService } from "./api-keys.service";

@ApiTags("api-keys")
@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @RequirePermission("apikeys:read")
  @ApiOperation({ summary: "List API keys (never exposes the key or its hash)" })
  async list(@CurrentUser() actor: RequestActor, @Query() query: ApiKeyListQueryDto) {
    return this.apiKeys.listApiKeys(actor, query);
  }

  @Post()
  @RequirePermission("apikeys:write")
  @ApiOperation({ summary: "Create an API key — the raw key is returned only once" })
  async create(@CurrentUser() actor: RequestActor, @Body() body: CreateApiKeyDto) {
    return this.apiKeys.createApiKey(actor, body);
  }

  @Delete(":id")
  @RequirePermission("apikeys:write")
  @ApiOperation({ summary: "Revoke an API key (idempotent)" })
  async revoke(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.apiKeys.revokeApiKey(actor, id);
  }
}
