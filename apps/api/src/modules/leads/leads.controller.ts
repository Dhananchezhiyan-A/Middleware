import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { CreateLeadDto, CreateSelectionDto, LeadListQueryDto, ManualSendDto } from "./leads.dtos";
import { LeadsService } from "./leads.service";
import { ManualSendService, type ManualSendBody } from "./manual-send.service";
import type { LeadFilterQuery } from "./lead-filters";

@ApiTags("leads")
@Controller("leads")
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly manualSend: ManualSendService,
  ) {}

  @Get()
  @RequirePermission("leads:read")
  @ApiOperation({ summary: "List leads (cursor pagination, filters, exact-match search)" })
  list(@CurrentUser() actor: RequestActor, @Query() query: LeadListQueryDto) {
    return this.leads.list(actor, query as never);
  }

  @Post()
  @RequirePermission("leads:write")
  @ApiOperation({ summary: "Create a lead manually (enqueued for processing)" })
  create(@CurrentUser() actor: RequestActor, @Body() body: CreateLeadDto) {
    return this.leads.create(actor, body);
  }

  @Post("selection")
  @RequirePermission("leads:read")
  @ApiOperation({
    summary: "Resolve every lead matching the filters into an expiring server-side selection",
  })
  createSelection(@CurrentUser() actor: RequestActor, @Body() body: CreateSelectionDto) {
    return this.manualSend.createSelection(actor, body as unknown as LeadFilterQuery);
  }

  @Post("manual-send/preview")
  @RequirePermission("leads:replay")
  @ApiOperation({ summary: "Authoritative eligibility counts before a manual send" })
  preview(@CurrentUser() actor: RequestActor, @Body() body: ManualSendDto) {
    return this.manualSend.preview(actor, body as unknown as ManualSendBody);
  }

  @Post("manual-send")
  @RequirePermission("leads:replay")
  @ApiOperation({ summary: "Queue deliveries for the selected leads (bounded batches, audited)" })
  send(@CurrentUser() actor: RequestActor, @Body() body: ManualSendDto) {
    return this.manualSend.send(actor, body as unknown as ManualSendBody);
  }

  @Get(":id")
  @RequirePermission("leads:read")
  @ApiOperation({ summary: "Lead detail with processing, scores and deliveries" })
  get(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.leads.getDetail(actor, id);
  }

  @Get(":id/timeline")
  @RequirePermission("leads:read")
  @ApiOperation({ summary: "Immutable pipeline timeline (stage events, scores, routing)" })
  timeline(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.leads.getTimeline(actor, id);
  }

  @Get(":id/payloads")
  @RequirePermission("leads:read")
  @ApiOperation({ summary: "Raw inbound payloads + canonical data" })
  payloads(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.leads.getPayloads(actor, id);
  }

  @Post(":id/replay")
  @RequirePermission("leads:replay")
  @ApiOperation({ summary: "Re-run the processing pipeline for a lead" })
  replay(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.leads.replay(actor, id);
  }

  @Delete(":id")
  @RequirePermission("leads:delete")
  @ApiOperation({ summary: "Delete a lead and its processing history (audited)" })
  remove(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.leads.remove(actor, id);
  }
}
