import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { CreateDestinationDto, SetCredentialDto, UpdateDestinationDto } from "./destinations.dtos";
import { DestinationsService } from "./destinations.service";

@ApiTags("destinations")
@Controller("destinations")
export class DestinationsController {
  constructor(private readonly destinations: DestinationsService) {}

  @Get("types")
  @RequirePermission("destinations:read")
  @ApiOperation({ summary: "Supported destination types + required config keys (from adapters)" })
  types() {
    return this.destinations.listTypes();
  }

  @Get()
  @RequirePermission("destinations:read")
  @ApiOperation({ summary: "List destinations with health and delivery counts" })
  list(@CurrentUser() actor: RequestActor) {
    return this.destinations.list(actor);
  }

  @Post()
  @RequirePermission("destinations:write")
  @ApiOperation({ summary: "Create a destination" })
  create(@CurrentUser() actor: RequestActor, @Body() body: CreateDestinationDto) {
    return this.destinations.create(actor, body);
  }

  @Get(":id")
  @RequirePermission("destinations:read")
  @ApiOperation({ summary: "Destination detail (credential metadata only, never the secret)" })
  get(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.destinations.get(actor, id);
  }

  @Patch(":id")
  @RequirePermission("destinations:write")
  @ApiOperation({ summary: "Update a destination" })
  update(@CurrentUser() actor: RequestActor, @Param("id") id: string, @Body() body: UpdateDestinationDto) {
    return this.destinations.update(actor, id, body);
  }

  @Delete(":id")
  @RequirePermission("destinations:write")
  @ApiOperation({ summary: "Delete a destination (blocked while deliveries exist)" })
  remove(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.destinations.remove(actor, id);
  }

  @Put(":id/credential")
  @RequirePermission("destinations:write")
  @ApiOperation({ summary: "Set/replace the destination credential (write-only; never returned)" })
  setCredential(
    @CurrentUser() actor: RequestActor,
    @Param("id") id: string,
    @Body() body: SetCredentialDto,
  ) {
    return this.destinations.setCredential(actor, id, body);
  }

  @Delete(":id/credential")
  @RequirePermission("destinations:write")
  @ApiOperation({ summary: "Remove the destination credential" })
  removeCredential(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.destinations.removeCredential(actor, id);
  }

  @Get(":id/health")
  @RequirePermission("destinations:read")
  @ApiOperation({ summary: "Last known destination health (real probe results)" })
  health(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.destinations.getHealth(actor, id);
  }

  @Post(":id/test")
  @RequirePermission("destinations:test")
  @ApiOperation({ summary: "Run a REAL connectivity/auth probe against the destination" })
  test(@CurrentUser() actor: RequestActor, @Param("id") id: string) {
    return this.destinations.testConnection(actor, id);
  }
}
