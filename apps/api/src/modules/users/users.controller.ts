import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "@middleware/types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/permissions.decorator";
import { CreateUserDto, UpdateUserDto, UserListQueryDto } from "./users.dtos";
import { UsersService } from "./users.service";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission("users:read")
  @ApiOperation({ summary: "List users (cursor paginated)" })
  async list(@CurrentUser() actor: RequestActor, @Query() query: UserListQueryDto) {
    return this.users.listUsers(actor, query);
  }

  @Post()
  @RequirePermission("users:write")
  @ApiOperation({ summary: "Create a user" })
  async create(@CurrentUser() actor: RequestActor, @Body() body: CreateUserDto) {
    return this.users.createUser(actor, body);
  }

  @Patch(":id")
  @RequirePermission("users:write")
  @ApiOperation({ summary: "Update a user's name, role or status" })
  async update(
    @CurrentUser() actor: RequestActor,
    @Param("id") id: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.users.updateUser(actor, id, body);
  }
}
