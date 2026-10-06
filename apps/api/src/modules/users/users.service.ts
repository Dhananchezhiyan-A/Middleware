import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { clampLimit, decodeCursor, encodeCursor, errors } from "@middleware/shared";
import type { Database, Prisma } from "@middleware/database";
import type { RequestActor, UserStatus } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export type UserView = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export interface UserCreateInput {
  email: string;
  name: string;
  password: string;
  roleId: string;
}

export interface UserUpdateInput {
  name?: string;
  roleId?: string;
  status?: UserStatus;
}

/** Reads the Prisma error code without importing the client runtime. */
function prismaErrorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Database,
    private readonly audit: AuditService,
  ) {}

  async listUsers(
    _actor: RequestActor,
    query: { cursor?: string; limit?: number },
  ): Promise<{ items: UserView[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit);
    const cursor = this.readCursor(query.cursor);
    const where: Prisma.UserWhereInput = {
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.t } },
              { createdAt: { equals: cursor.t }, id: { lt: cursor.i } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: USER_SELECT,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id }) : null;
    return { items, nextCursor };
  }

  async createUser(actor: RequestActor, input: UserCreateInput): Promise<UserView> {
    const role = await this.prisma.role.findFirst({
      where: { id: input.roleId },
      select: { id: true },
    });
    if (!role) throw errors.validation("Role not found");

    const passwordHash = await bcrypt.hash(input.password, 12);

    let user: UserView;
    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          roleId: role.id,
        },
        select: USER_SELECT,
      });
    } catch (err) {
      if (prismaErrorCode(err) === "P2002") {
        throw errors.conflict("A user with this email already exists.");
      }
      throw err;
    }

    await this.audit.record({
      action: "user.created",
      entityType: "User",
      entityId: user.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      // Never include the password (or its hash) in the audit trail.
      after: { id: user.id, name: user.name, email: user.email, status: user.status, roleId: role.id },
    });
    return user;
  }

  async updateUser(actor: RequestActor, id: string, input: UserUpdateInput): Promise<UserView> {
    const target = await this.prisma.user.findFirst({
      where: { id },
      select: { id: true, name: true, email: true, status: true, roleId: true },
    });
    if (!target) throw errors.notFound("User not found.");

    if (input.status === "DISABLED" && target.id === actor.userId) {
      throw errors.badRequest("You cannot disable your own account.");
    }

    let roleId = target.roleId;
    if (input.roleId !== undefined && input.roleId !== target.roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: input.roleId },
        select: { id: true },
      });
      if (!role) throw errors.validation("Role not found");
      roleId = role.id;
    }

    const before = {
      id: target.id,
      name: target.name,
      email: target.email,
      status: target.status,
      roleId: target.roleId,
    };

    const user = await this.prisma.user.update({
      where: { id: target.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        roleId,
      },
      select: USER_SELECT,
    });

    const after = {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      roleId,
    };

    await this.audit.record({
      action: "user.updated",
      entityType: "User",
      entityId: user.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before,
      after,
    });
    return user;
  }

  /** Decodes the opaque list cursor; rejects malformed cursors loudly. */
  private readCursor(cursor: string | undefined): { t: Date; i: string } | null {
    if (!cursor) return null;
    const decoded = decodeCursor<Record<string, unknown>>(cursor);
    if (
      !decoded ||
      typeof decoded.t !== "string" ||
      typeof decoded.i !== "string" ||
      Number.isNaN(Date.parse(decoded.t))
    ) {
      throw errors.validation("Invalid pagination cursor.");
    }
    return { t: new Date(decoded.t), i: decoded.i };
  }
}
