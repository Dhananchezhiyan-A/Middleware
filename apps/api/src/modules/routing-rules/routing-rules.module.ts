import { Module } from "@nestjs/common";
import { RoutingRulesController } from "./routing-rules.controller";
import { RoutingRulesService } from "./routing-rules.service";

@Module({
  controllers: [RoutingRulesController],
  providers: [RoutingRulesService],
})
export class RoutingRulesModule {}
