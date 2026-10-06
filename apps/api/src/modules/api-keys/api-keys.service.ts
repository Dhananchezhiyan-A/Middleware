import { Inject, Injectable } from "@nestjs/common";
import { clampLimit, decodeCursor, encodeCursor, errors, randomToken, sha256Hex } from "@middleware/shared";
import type { Database, Prisma } from "@middleware/database";
import type { RequestActor } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";

/** Never selects `keyHash` — the hash must never leave the database. */
const API_KEY_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  status: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.ApiKeySelect;

export type ApiKeyView = Prisma.ApiKeyGetPayload<{ select: typeof API_KEY_SELECT }>;

export interface ApiKeyCreateInput {
  name: string;
  scopes: string[];
  expiresInDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Database,
    private readonly audit: AuditService,
  ) {}

  async listApiKeys(
    _actor: RequestActor,
    query: { cursor?: string; limit?: number },
  ): Promise<{ items: ApiKeyView[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit);
    const cursor = this.readCursor(query.cursor);
    const where: Prisma.ApiKeyWhereInput = {
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.t } },
              { createdAt: { equals: cursor.t }, id: { lt: cursor.i } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.apiKey.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: API_KEY_SELECT,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id }) : null;
    return { items, nextCursor };
  }

  /**
   * Creates an API key. The RAW key is returned exactly once here — only its
   * SHA-256 hash and displayable prefix are stored.
   */
  async createApiKey(
    actor: RequestActor,
    input: ApiKeyCreateInput,
  ): Promise<ApiKeyView & { apiKey: string }> {
    const rawKey = `mw_${randomToken(32)}`;
    const keyHash = sha256Hex(rawKey);
    const keyPrefix = `${rawKey.slice(0, 12)}…`;
    const expiresAt =
      input.expiresInDays !== undefined ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null;

    const created = await this.prisma.apiKey.create({
      data: {
        userId: actor.userId,
        name: input.name,
        keyPrefix,
        keyHash,
        scopes: input.scopes,
        expiresAt,
      },
      select: API_KEY_SELECT,
    });

    await this.audit.record({
      action: "apikey.created",
      entityType: "ApiKey",
      entityId: created.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      // No raw key, no hash — only identifying metadata.
      after: { name: created.name, keyPrefix: created.keyPrefix },
    });

    return { ...created, apiKey: rawKey };
  }

  /** Idempotent: revoking an already-revoked key still reports `{revoked:true}`. */
  async revokeApiKey(actor: RequestActor, id: string): Promise<{ revoked: boolean }> {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id },
      select: { id: true, name: true, keyPrefix: true, status: true, revokedAt: true },
    });
    if (!existing) throw errors.notFound("API key not found.");
    if (existing.status === "REVOKED" || existing.revokedAt) return { revoked: true };

    const revoked = await this.prisma.apiKey.update({
      where: { id: existing.id },
      data: { status: "REVOKED", revokedAt: new Date() },
      select: API_KEY_SELECT,
    });

    await this.audit.record({
      action: "apikey.revoked",
      entityType: "ApiKey",
      entityId: revoked.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      before: {
        id: existing.id,
        name: existing.name,
        keyPrefix: existing.keyPrefix,
        status: existing.status,
      },
      after: {
        id: revoked.id,
        name: revoked.name,
        keyPrefix: revoked.keyPrefix,
        status: revoked.status,
        revokedAt: revoked.revokedAt,
      },
    });

    return { revoked: true };
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
