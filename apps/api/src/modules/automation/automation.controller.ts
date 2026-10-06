import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import {
  CreateScoringRuleSetDto,
  ToggleScoringRuleSetDto,
  UpsertDedupConfigDto,
} from "./automation.dtos";
import { AutomationService } from "./automation.service";

@ApiTags("automation")
@Controller("automation")
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  // --- Scoring -------------------------------------------------------------

  @Get("scoring")
  @RequirePermission("scoring:read")
  @ApiOperation({ summary: "List all scoring rule set versions" })
  async listScoring() {
    return this.automation.listScoringRuleSets();
  }

  @Post("scoring")
  @RequirePermission("scoring:write")
  @ApiOperation({ summary: "Create the next scoring rule set version" })
  async createScoring(
    @CurrentUser() actor: RequestActor,
    @Body() body: CreateScoringRuleSetDto,
  ) {
    return this.automation.createScoringRuleSet(actor, body);
  }

  @Patch("scoring/:id")
  @RequirePermission("scoring:write")
  @ApiOperation({ summary: "Enable or disable a scoring rule set" })
  async toggleScoring(
    @CurrentUser() actor: RequestActor,
    @Param("id") id: string,
    @Body() body: ToggleScoringRuleSetDto,
  ) {
    return this.automation.toggleScoringRuleSet(actor, id, body);
  }

  // --- Deduplication -------------------------------------------------------

  @Get("dedup")
  @RequirePermission("dedup:read")
  @ApiOperation({ summary: "Get the deduplication config (created with defaults on first read)" })
  async getDedup() {
    return this.automation.getDedupConfig();
  }

  @Put("dedup")
  @RequirePermission("dedup:write")
  @ApiOperation({ summary: "Replace the deduplication config" })
  async putDedup(@CurrentUser() actor: RequestActor, @Body() body: UpsertDedupConfigDto) {
    return this.automation.upsertDedupConfig(actor, body);
  }

  // --- Enrichment ----------------------------------------------------------

  @Get("enrichment")
  @RequirePermission("enrichment:read")
  @ApiOperation({ summary: "Enrichment provider status (not configured in this phase)" })
  async getEnrichment() {
    return this.automation.getEnrichmentStatus();
  }
}
