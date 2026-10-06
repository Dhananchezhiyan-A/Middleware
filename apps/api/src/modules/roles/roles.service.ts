import { Inject, Injectable } from "@nestjs/common";
import { errors } from "@middleware/shared";
import type { Database, Prisma } from "@middleware/database";
import { PERMISSIONS, ROLE_TEMPLATES, type Permission, type RequestActor } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";

const ROLE_INCLUDE = {
  _count: { select: { users: true } },
} as const satisfies Prisma.RoleInclude;

type RoleRecord = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

export interface RoleListItem {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  createdAt: Date;
  userCount: number;
}

export interface RoleCreateInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface RoleUpdateInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

const PERMISSION_SET: ReadonlySet<string> = new Set<string>(PERMISSIONS);

/** Reads the Prisma error code without importing the client runtime. */
function prismaErrorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

@Injectable()
export class RolesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Database,
    private readonly audit: AuditService,
  ) {}

  async listRoles(): Promise<RoleListItem[]> {
    const rows = await this.prisma.role.findMany({
      orderBy: { name: "asc" },
      include: ROLE_INCLUDE,
    });
    return rows.map((row) => this.toListItem(row));
  }

  /**
   * Static reference data: the fixed permission catalog from @middleware/types
   * plus the templates seeded for this application.
   */
  getPermissionCatalog(): { items: Permission[]; templates: typeof ROLE_TEMPLATES } {
    return { items: [...PERMISSIONS], templates: ROLE_TEMPLATES };
  }

  async createRole(actor: RequestActor, input: RoleCreateInput): Promise<RoleListItem> {
    this.assertValidPermissions(input.permissions);

    let record: RoleRecord;
    try {
      record = await this.prisma.role.create({
        data: {
          name: input.name,
          description: input.description,
          permissions: input.permissions,
          isSystem: false,
        },
        include: ROLE_INCLUDE,
      });
    } catch (err) {
      if (prismaErrorCode(err) === "P2002") {
        throw errors.conflict("A role with this name already exists.");
      }
      throw err;
    }

    await this.audit.record({
      action: "role.created",
      entityType: "Role",
      entityId: record.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      after: {
        name: record.name,
        description: record.description,
        permissions: record.permissions,
        isSystem: false,
      },
    });
    return this.toListItem(record);
  }

  async updateRole(
    actor: RequestActor,
    id: string,
    input: RoleUpdateInput,
  ): Promise<RoleListItem> {
    const existing = await this.prisma.role.findFirst({
      where: { id },
      include: ROLE_INCLUDE,
    });
    if (!existing) throw errors.notFound("Role not found.");
    if (existing.isSystem) throw errors.conflict("System roles cannot be modified.");

    if (
      input.name === undefined &&
      input.description === undefined &&
      input.permissions === undefined
    ) {
      return this.toListItem(existing);
    }
    if (input.permissions !== undefined) this.assertValidPermissions(input.permissions);

    const before = {
      name: existing.name,
      description: existing.description,
      permissions: existing.permissions,
    };

    let record: RoleRecord;
    try {
      record = await this.prisma.role.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
        },
        include: ROLE_INCLUDE,
      });
    } catch (err) {
      if (prismaErrorCode(err) === "P2002") {
        throw errors.conflict("A role with this name already exists.");
      }
      throw err;
    }

    const after = {
      name: record.name,
      description: record.description,
      permissions: record.permissions,
    };

    await this.audit.record({
      action: "role.updated",
      entityType: "Role",
      entityId: record.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before,
      after,
    });
    return this.toListItem(record);
  }

  async deleteRole(actor: RequestActor, id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.role.findFirst({
      where: { id },
      select: { id: true, name: true, isSystem: true },
    });
    if (!existing) throw errors.notFound("Role not found.");
    if (existing.isSystem) throw errors.conflict("System roles cannot be modified.");

    try {
      await this.prisma.role.delete({ where: { id: existing.id } });
    } catch (err) {
      // Users.roleId is ON DELETE RESTRICT → P2003 = still assigned.
      if (prismaErrorCode(err) === "P2003") {
        throw errors.conflict("Role is still assigned to users.");
      }
      throw err;
    }

    await this.audit.record({
      action: "role.deleted",
      entityType: "Role",
      entityId: existing.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before: { id: existing.id, name: existing.name },
    });
    return { deleted: true };
  }

  private assertValidPermissions(permissions: string[]): void {
    const invalid = permissions.filter((code) => !PERMISSION_SET.has(code));
    if (invalid.length > 0) {
      throw errors.validation("Invalid permission codes.", { invalid });
    }
  }

  private toListItem(record: RoleRecord): RoleListItem {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      permissions: record.permissions,
      isSystem: record.isSystem,
      createdAt: record.createdAt,
      userCount: record._count.users,
    };
  }
}
