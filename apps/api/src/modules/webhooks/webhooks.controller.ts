import { Body, Controller, Get, Headers, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { getEnv } from "@middleware/config";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import type { RequestActor } from "@middleware/types";
import { WebhooksService, type IngressResult } from "./webhooks.service";

const env = getEnv();
type RawRequest = Request & { rawBody?: Buffer };

@ApiTags("webhooks")
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** Public, URL-identified endpoint; rate-limited independently of the API. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: env.WEBHOOK_RATE_LIMIT_PER_MIN } })
  @Post("inbound/:publicId")
  @ApiOperation({ summary: "Inbound lead webhook (idempotent, fast-ack)" })
  async inbound(
    @Param("publicId") publicId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: RawRequest,
  ): Promise<IngressResult> {
    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(body ?? null);
    return this.webhooks.ingress(publicId, body, headers, rawBody, req.ip);
  }

  @Get("events")
  @RequirePermission("sources:read")
  @ApiOperation({ summary: "Inbound webhook event log (status, duplicates, errors)" })
  listEvents(
    @CurrentUser() actor: RequestActor,
    @Query() query: { status?: string; sourceAccountId?: string; cursor?: string; limit?: number },
  ) {
    return this.webhooks.listEvents(actor, query);
  }

  @Get("events/:id")
  @RequirePermission("sources:read")
  @ApiOperation({ summary: "Webhook event detail (sanitized payload)" })
  getEvent(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.webhooks.getEvent(actor, id);
  }
}
