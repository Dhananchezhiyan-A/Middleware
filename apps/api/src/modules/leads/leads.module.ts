import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { ManualSendService } from "./manual-send.service";

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, ManualSendService],
  exports: [LeadsService],
})
export class LeadsModule {}
