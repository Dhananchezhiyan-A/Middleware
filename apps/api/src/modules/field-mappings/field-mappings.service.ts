import { Inject, Injectable } from "@nestjs/common";
import { clampLimit, decodeCursor, encodeCursor, errors } from "@middleware/shared";
import type { Database, Prisma } from "@middleware/database";
import type { DestinationType, FieldMappingStatus, RequestActor } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";

const LIST_SELECT = {
  id: true,
  name: true,
  destinationId: true,
  status: true,
  activeVersionId: true,
  // Used only for cursor pagination — not part of the list item shape.
  createdAt: true,
  updatedAt: true,
  destination: { select: { id: true, name: true, type: true } },
  _count: { select: { versions: true } },
} satisfies Prisma.FieldMappingSelect;

type ListRecord = Prisma.FieldMappingGetPayload<{ select: typeof LIST_SELECT }>;

const DETAIL_SELECT = {
  id: true,
  name: true,
  destinationId: true,
  status: true,
  activeVersionId: true,
  createdAt: true,
  updatedAt: true,
  destination: { select: { id: true, name: true, type: true } },
  versions: {
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      fields: true,
      notes: true,
      createdBy: true,
      createdAt: true,
    },
  },
} satisfies Prisma.FieldMappingSelect;

type DetailRecord = Prisma.FieldMappingGetPayload<{ select: typeof DETAIL_SELECT }>;

export interface FieldMappingDestinationView {
  id: string;
  name: string;
  type: DestinationType;
}

export interface FieldMappingListItem {
  id: string;
  name: string;
  destinationId: string;
  status: FieldMappingStatus;
  activeVersionId: string | null;
  versionCount: number;
  destination: FieldMappingDestinationView;
  updatedAt: Date;
}

export interface FieldMappingVersionView {
  id: string;
  version: number;
  fields: Prisma.JsonValue;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface FieldMappingDetail {
  id: string;
  name: string;
  destinationId: string;
  status: FieldMappingStatus;
  activeVersionId: string | null;
  destination: FieldMappingDestinationView;
  createdAt: Date;
  updatedAt: Date;
  versions: FieldMappingVersionView[];
}

export interface FieldMappingCreateInput {
  destinationId: string;
  name: string;
  fields: unknown[];
  notes?: string;
  activate: boolean;
}

export interface FieldMappingVersionInput {
  fields: unknown[];
  notes?: string;
  activate: boolean;
}

/** Reads the Prisma error code without importing the client runtime. */
function prismaErrorCode(err: unknown): string | undefined {
  if (err !== null && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

@Injectable()
export class FieldMappingsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Database,
    private readonly audit: AuditService,
  ) {}

  async listFieldMappings(
    _actor: RequestActor,
    query: { cursor?: string; limit?: number; destinationId?: string },
  ): Promise<{ items: FieldMappingListItem[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit);
    const cursor = this.readCursor(query.cursor);
    const where: Prisma.FieldMappingWhereInput = {
      ...(query.destinationId !== undefined ? { destinationId: query.destinationId } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.t } },
              { createdAt: { equals: cursor.t }, id: { lt: cursor.i } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.fieldMapping.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: LIST_SELECT,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id }) : null;
    return { items: page.map((row) => this.toListItem(row)), nextCursor };
  }

  async getFieldMapping(_actor: RequestActor, id: string): Promise<FieldMappingDetail> {
    return this.getDetailOrThrow(id);
  }

  async createFieldMapping(
    actor: RequestActor,
    input: FieldMappingCreateInput,
  ): Promise<FieldMappingDetail> {
    const destination = await this.prisma.destination.findFirst({
      where: { id: input.destinationId },
      select: { id: true },
    });
    if (!destination) throw errors.notFound("Destination not found.");

    let mappingId: string;
    let versionId: string;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const mapping = await tx.fieldMapping.create({
          data: {
            destinationId: destination.id,
            name: input.name,
            status: input.activate ? "ACTIVE" : "DRAFT",
          },
          select: { id: true },
        });
        const version = await tx.fieldMappingVersion.create({
          data: {
            mappingId: mapping.id,
            version: 1,
            fields: input.fields as Prisma.InputJsonValue,
            notes: input.notes,
            createdBy: actor.userId,
          },
          select: { id: true },
        });
        if (input.activate) {
          await tx.fieldMapping.update({
            where: { id: mapping.id },
            data: { activeVersionId: version.id },
          });
        }
        return { mappingId: mapping.id, versionId: version.id };
      });
      mappingId = created.mappingId;
      versionId = created.versionId;
    } catch (err) {
      if (prismaErrorCode(err) === "P2002") {
        throw errors.conflict("A field mapping with this name already exists for this destination.");
      }
      throw err;
    }

    await this.audit.record({
      action: "mapping.created",
      entityType: "FieldMapping",
      entityId: mappingId,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      after: {
        name: input.name,
        destinationId: destination.id,
        status: input.activate ? "ACTIVE" : "DRAFT",
        version: 1,
        activeVersionId: input.activate ? versionId : null,
      },
    });
    return this.getDetailOrThrow(mappingId);
  }

  async createVersion(
    actor: RequestActor,
    id: string,
    input: FieldMappingVersionInput,
  ): Promise<FieldMappingVersionView> {
    const mapping = await this.prisma.fieldMapping.findFirst({
      where: { id },
      select: { id: true, name: true },
    });
    if (!mapping) throw errors.notFound("Field mapping not found.");

    const version = await this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.fieldMappingVersion.aggregate({
        where: { mappingId: mapping.id },
        _max: { version: true },
      });
      const nextVersion = (aggregate._max.version ?? 0) + 1;
      const created = await tx.fieldMappingVersion.create({
        data: {
          mappingId: mapping.id,
          version: nextVersion,
          fields: input.fields as Prisma.InputJsonValue,
          notes: input.notes,
          createdBy: actor.userId,
        },
        select: {
          id: true,
          version: true,
          fields: true,
          notes: true,
          createdBy: true,
          createdAt: true,
        },
      });
      if (input.activate) {
        await tx.fieldMapping.update({
          where: { id: mapping.id },
          data: { activeVersionId: created.id, status: "ACTIVE" },
        });
      }
      return created;
    });

    await this.audit.record({
      action: "mapping.version_created",
      entityType: "FieldMapping",
      entityId: mapping.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      after: { name: mapping.name, version: version.version, activated: input.activate },
      metadata: { version: version.version },
    });
    return version;
  }

  async activateVersion(
    actor: RequestActor,
    id: string,
    input: { version: number },
  ): Promise<FieldMappingDetail> {
    const mapping = await this.prisma.fieldMapping.findFirst({
      where: { id },
      select: { id: true, name: true },
    });
    if (!mapping) throw errors.notFound("Field mapping not found.");

    const version = await this.prisma.fieldMappingVersion.findFirst({
      where: { mappingId: mapping.id, version: input.version },
      select: { id: true, version: true },
    });
    if (!version) throw errors.notFound("Field mapping version not found.");

    await this.prisma.fieldMapping.update({
      where: { id: mapping.id },
      data: { activeVersionId: version.id, status: "ACTIVE" },
    });

    await this.audit.record({
      action: "mapping.activated",
      entityType: "FieldMapping",
      entityId: mapping.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      after: { name: mapping.name, version: version.version, activeVersionId: version.id },
    });
    return this.getDetailOrThrow(mapping.id);
  }

  async deleteFieldMapping(actor: RequestActor, id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.fieldMapping.findFirst({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) throw errors.notFound("Field mapping not found.");

    // FieldMappingVersion rows are removed by the schema's cascade.
    await this.prisma.fieldMapping.delete({ where: { id: existing.id } });

    await this.audit.record({
      action: "mapping.deleted",
      entityType: "FieldMapping",
      entityId: existing.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before: { id: existing.id, name: existing.name },
    });
    return { deleted: true };
  }

  private async getDetailOrThrow(id: string): Promise<FieldMappingDetail> {
    const mapping = await this.prisma.fieldMapping.findFirst({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!mapping) throw errors.notFound("Field mapping not found.");
    return this.toDetail(mapping);
  }

  private toListItem(row: ListRecord): FieldMappingListItem {
    return {
      id: row.id,
      name: row.name,
      destinationId: row.destinationId,
      status: row.status,
      activeVersionId: row.activeVersionId,
      versionCount: row._count.versions,
      destination: row.destination,
      updatedAt: row.updatedAt,
    };
  }

  private toDetail(row: DetailRecord): FieldMappingDetail {
    return {
      id: row.id,
      name: row.name,
      destinationId: row.destinationId,
      status: row.status,
      activeVersionId: row.activeVersionId,
      destination: row.destination,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      versions: row.versions,
    };
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
