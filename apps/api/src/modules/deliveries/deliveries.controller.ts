import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { deliveryListQuerySchema } from "@middleware/validation";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { DeliveriesService } from "./deliveries.service";

class DeliveryListQueryDto extends createZodDto(deliveryListQuerySchema) {}

@ApiTags("deliveries")
@Controller("deliveries")
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get("queue-stats")
  @RequirePermission("deliveries:read")
  @ApiOperation({ summary: "Real BullMQ queue + dead-letter counts (errors reported verbatim)" })
  queueStats() {
    return this.deliveries.queueStats();
  }

  @Get("dead-letter")
  @RequirePermission("deliveries:read")
  @ApiOperation({ summary: "Dead-lettered jobs with failure reasons (e.g. ?queue=delivery)" })
  deadLetter(@Query("queue") queue: string, @Query("limit") limit?: string) {
    return this.deliveries.deadLetterJobs(queue || "delivery-dlq", limit ? Number(limit) : undefined);
  }

  @Get("failed")
  @RequirePermission("deliveries:read")
  @ApiOperation({ summary: "Failed jobs awaiting retry/dead-lettering" })
  failed(@Query("queue") queue: string, @Query("limit") limit?: string) {
    return this.deliveries.failedJobs(queue || "delivery", limit ? Number(limit) : undefined);
  }

  @Get()
  @RequirePermission("deliveries:read")
  @ApiOperation({ summary: "List deliveries (cursor pagination + filters)" })
  list(@Query() query: DeliveryListQueryDto) {
    return this.deliveries.list(query as never);
  }

  @Get(":id")
  @RequirePermission("deliveries:read")
  @ApiOperation({ summary: "Delivery detail with the full attempt history" })
  get(@Param("id") id: string) {
    return this.deliveries.getDetail(id);
  }

  @Post(":id/replay")
  @RequirePermission("deliveries:retry")
  @ApiOperation({ summary: "Replay a FAILED/DEAD delivery (audited; attempt history preserved)" })
  replay(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.deliveries.replay(actor, id);
  }
}
