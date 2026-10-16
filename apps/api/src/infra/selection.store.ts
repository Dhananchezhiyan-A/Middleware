import { randomBytes } from "node:crypto";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { AppError, redisConnectionOptions } from "@middleware/shared";

/**
 * Server-side snapshots of "all filtered leads" selections.
 *
 * The browser never receives the matching lead IDs: it holds only an opaque,
 * expiring token. The record stores the exact IDs resolved at selection time,
 * so leads created AFTER the selection can never be sent silently, and a send
 * revalidates those IDs (existence + permissions) against PostgreSQL.
 *
 * Storage is Redis (the same instance BullMQ uses) with a TTL — no database
 * migration. Outages fail loudly (503) instead of falling back to anything
 * less safe.
 */

export interface LeadSelectionRecord {
  /** User the selection was created for — a token is only valid for them. */
  actorId: string;
  mode: "page" | "filtered";
  /** Resolved lead IDs at selection time (bounded by LEAD_SELECTION_MAX). */
  ids: string[];
  /** The filter criteria the selection was resolved from (display/audit). */
  filters: Record<string, unknown>;
  createdAt: string;
}

/** Selection tokens are valid for 30 minutes. */
export const SELECTION_TTL_SECONDS = 1800;
const KEY_PREFIX = "lead-selection:";
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

export function isSelectionToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

function unavailable(cause: unknown): AppError {
  return new AppError(
    "SERVICE_UNAVAILABLE",
    "The selection service is temporarily unavailable. Please try again.",
    { cause, retryable: true },
  );
}

@Injectable()
export class LeadSelectionStore implements OnModuleDestroy {
  private client: Redis | null = null;

  private redis(): Redis {
    if (this.client) return this.client;
    const opts = redisConnectionOptions() as { host: string; port: number; password?: string };
    this.client = new Redis({
      host: opts.host,
      port: opts.port,
      ...(opts.password ? { password: opts.password } : {}),
      connectTimeout: 5_000,
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    this.client.on("error", () => {
      // Errors surface through command promises; keep the process quiet.
    });
    return this.client;
  }

  /** Stores `record` under a fresh opaque token and returns it. */
  async create(record: Omit<LeadSelectionRecord, "createdAt">): Promise<{
    token: string;
    expiresAt: string;
  }> {
    const token = randomBytes(24).toString("base64url");
    const payload: LeadSelectionRecord = { ...record, createdAt: new Date().toISOString() };
    try {
      await this.redis().set(
        KEY_PREFIX + token,
        JSON.stringify(payload),
        "EX",
        SELECTION_TTL_SECONDS,
      );
    } catch (err) {
      throw unavailable(err);
    }
    return {
      token,
      expiresAt: new Date(Date.now() + SELECTION_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Returns the record, or null when it expired, was consumed, or is unknown. */
  async get(token: string): Promise<LeadSelectionRecord | null> {
    if (!isSelectionToken(token)) return null;
    try {
      const raw = await this.redis().get(KEY_PREFIX + token);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LeadSelectionRecord;
      if (!parsed || !Array.isArray(parsed.ids)) return null;
      return parsed;
    } catch (err) {
      throw unavailable(err);
    }
  }

  /** Consumes a selection after a completed send. Returns true when it existed. */
  async delete(token: string): Promise<boolean> {
    if (!isSelectionToken(token)) return false;
    try {
      const count = await this.redis().del(KEY_PREFIX + token);
      return count > 0;
    } catch (err) {
      throw unavailable(err);
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
    this.client = null;
  }
}
