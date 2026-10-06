import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { AuditLogQueryDto } from "./audit-logs.dtos";
import { AuditLogsService } from "./audit-logs.service";

@ApiTags("audit-logs")
@Controller("audit-logs")
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @RequirePermission("audit:read")
  @ApiOperation({
    summary: "List application audit log entries (cursor paginated)",
  })
  async list(@Query() query: AuditLogQueryDto) {
    return this.auditLogs.listAuditLogs(query);
  }
}
