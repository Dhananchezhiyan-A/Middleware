import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { AnalyticsService } from "./analytics.service";

const daysQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});
class DaysQueryDto extends createZodDto(daysQuery) {}

@ApiTags("analytics")
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("overview")
  @RequirePermission("analytics:read")
  @ApiOperation({ summary: "Dashboard overview — real aggregates over PostgreSQL" })
  overview() {
    return this.analytics.overview();
  }

  @Get("timeseries")
  @RequirePermission("analytics:read")
  @ApiOperation({ summary: "Daily lead intake + delivery outcomes (1–90 days)" })
  timeseries(@Query() query: DaysQueryDto) {
    return this.analytics.timeseries(this.analytics.assertDays(query.days));
  }

  @Get("sources")
  @RequirePermission("analytics:read")
  @ApiOperation({ summary: "Per-source lead counts by status" })
  sources() {
    return this.analytics.sourcePerformance();
  }

  @Get("destinations")
  @RequirePermission("analytics:read")
  @ApiOperation({ summary: "Per-destination delivery success rate + latency" })
  destinations() {
    return this.analytics.destinationPerformance();
  }

  @Get("pipeline")
  @RequirePermission("analytics:read")
  @ApiOperation({ summary: "Pipeline funnel — leads by current stage" })
  pipeline() {
    return this.analytics.pipelineFunnel();
  }
}
