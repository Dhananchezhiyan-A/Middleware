import { Injectable } from "@nestjs/common";
import { getPrisma } from "@middleware/database";
import { AppError, encryptSecret, errors, randomToken, sanitizeDeep, sha256Hex } from "@middleware/shared";
import { getEnv } from "@middleware/config";
import type { RequestActor, SourceType } from "@middleware/types";
import { AuditService } from "../../infra/audit.module";

/**
 * Lead sources and their inbound accounts (webhook endpoints).
 *
 * Security rules:
 *  - Public webhook URLs identify inbound accounts; callers do not need
 *    signing credentials.
 *  - Legacy signing credentials remain encrypted and are never exposed in reads.
 *  - publicId is random and unguessable; it is the only identifier in the
 *    inbound URL (no internal source/account id disclosure).
 */

export interface AccountWithUrl {
  id: string;
  sourceId: string;
  name: string;
  publicId: string;
  config: unknown;
  webhookUrl: string;
  createdAt: Date;
  /** Whether an HMAC signing secret exists (metadata only — not the value). */
  hasSigningSecret: boolean;
}

@Injectable()
export class SourcesService {
  constructor(private readonly audit: AuditService) {}

  /** Webhook URL for an inbound account (public-facing endpoint). */
  webhookUrl(publicId: string): string {
    // Global prefix "api" + URI versioning (defaultVersion "1") → /api/v1/...
    return `${getEnv().PUBLIC_API_BASE_URL.replace(/\/$/, "")}/api/v1/webhooks/inbound/${publicId}`;
  }

  private toAccountWithUrl(
    account: {
      id: string;
      sourceId: string;
      name: string;
      publicId: string;
      config: unknown;
      createdAt: Date;
    },
    hasSigningSecret: boolean,
  ): AccountWithUrl {
    return {
      ...account,
      config: sanitizeDeep(account.config),
      webhookUrl: this.webhookUrl(account.publicId),
      hasSigningSecret,
    };
  }

  /** Account ids that have a WEBHOOK_HMAC credential (existence only). */
  private async accountIdsWithSecret(accountIds: string[]): Promise<Set<string>> {
    if (accountIds.length === 0) return new Set();
    const rows = await getPrisma().integrationCredential.findMany({
      where: { sourceAccountId: { in: accountIds }, type: "WEBHOOK_HMAC" },
      select: { sourceAccountId: true },
    });
    return new Set(rows.map((row) => row.sourceAccountId).filter((id): id is string => id !== null));
  }

  // --- Sources ---------------------------------------------------------------

  async listSources() {
    return getPrisma().leadSource.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { accounts: true, leads: true } } },
    });
  }

  async getSource(id: string) {
    const source = await getPrisma().leadSource.findFirst({
      where: { id },
      include: { accounts: { orderBy: { createdAt: "asc" } }, _count: { select: { leads: true } } },
    });
    if (!source) throw errors.notFound("Source not found.");
    return {
      ...source,
      accounts: source.accounts.map((account) => ({
        ...account,
        config: sanitizeDeep(account.config),
      })),
    };
  }

  async createSource(_actor: RequestActor, input: { type: SourceType; code: string; name: string; config?: Record<string, unknown> }) {
    const prisma = getPrisma();
    try {
      const source = await prisma.leadSource.create({
        data: {
          type: input.type,
          code: input.code,
          name: input.name,
          config: (input.config ?? {}) as never,
        },
      });
      await this.audit.record({
        action: "source.created",
        entityType: "LeadSource",
        entityId: source.id,
        after: source,
      });
      return source;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw errors.conflict(`A source with code "${input.code}" already exists.`);
      }
      throw err;
    }
  }

  async updateSource(_actor: RequestActor, id: string, input: { name?: string; config?: Record<string, unknown> }) {
    const prisma = getPrisma();
    const before = await this.getSource(id);
    const source = await prisma.leadSource.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.config !== undefined ? { config: input.config as never } : {}),
      },
    });
    await this.audit.record({
      action: "source.updated",
      entityType: "LeadSource",
      entityId: id,
      before: { name: before.name, config: before.config },
      after: { name: source.name, config: source.config },
    });
    return source;
  }

  async deleteSource(_actor: RequestActor, id: string): Promise<{ deleted: boolean }> {
    const prisma = getPrisma();
    const before = await this.getSource(id);
    try {
      await prisma.leadSource.delete({ where: { id } });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2003") {
        throw errors.conflict("Source still has leads or accounts attached and cannot be deleted.");
      }
      throw err;
    }
    await this.audit.record({
      action: "source.deleted",
      entityType: "LeadSource",
      entityId: id,
      before: { code: before.code, name: before.name },
    });
    return { deleted: true };
  }

  // --- Accounts ---------------------------------------------------------------

  async listAccounts(sourceId: string) {
    await this.getSource(sourceId);
    const accounts = await getPrisma().leadSourceAccount.findMany({
      where: { sourceId },
      orderBy: { createdAt: "asc" },
    });
    const withSecret = await this.accountIdsWithSecret(accounts.map((a) => a.id));
    return accounts.map((a) => this.toAccountWithUrl(a, withSecret.has(a.id)));
  }

  /**
   * Creates an inbound account. For webhook-style sources a signing secret is
   * generated immediately and returned ONCE — it is never retrievable again.
   */
  async createAccount(
    _actor: RequestActor,
    sourceId: string,
    input: { name: string; config?: Record<string, unknown> },
  ) {
    const prisma = getPrisma();
    await this.getSource(sourceId);
    const publicId = randomToken(12);
    const account = await prisma.leadSourceAccount.create({
      data: {
        sourceId,
        name: input.name,
        publicId,
        config: (input.config ?? {}) as never,
      },
    });

    await this.audit.record({
      action: "source.account.created",
      entityType: "LeadSourceAccount",
      entityId: account.id,
      after: { name: account.name, sourceId },
    });

    return this.toAccountWithUrl(account, false);
  }

  async updateAccount(_actor: RequestActor, accountId: string, input: { name?: string; config?: Record<string, unknown> }) {
    const prisma = getPrisma();
    const account = await prisma.leadSourceAccount.findFirst({
      where: { id: accountId },
    });
    if (!account) throw errors.notFound("Source account not found.");
    const updated = await prisma.leadSourceAccount.update({
      where: { id: accountId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.config !== undefined ? { config: input.config as never } : {}),
      },
    });
    await this.audit.record({
      action: "source.account.updated",
      entityType: "LeadSourceAccount",
      entityId: accountId,
      before: { name: account.name, config: account.config },
      after: { name: updated.name, config: updated.config },
    });
    const withSecret = await this.accountIdsWithSecret([accountId]);
    return this.toAccountWithUrl(updated, withSecret.has(accountId));
  }

  async deleteAccount(_actor: RequestActor, accountId: string): Promise<{ deleted: boolean }> {
    const prisma = getPrisma();
    const account = await prisma.leadSourceAccount.findFirst({
      where: { id: accountId },
    });
    if (!account) throw errors.notFound("Source account not found.");
    try {
      await prisma.leadSourceAccount.delete({ where: { id: accountId } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2003") {
        throw errors.conflict("Account still has leads attached and cannot be deleted.");
      }
      throw err;
    }
    await this.audit.record({
      action: "source.account.deleted",
      entityType: "LeadSourceAccount",
      entityId: accountId,
      before: { name: account.name, publicId: account.publicId },
    });
    return { deleted: true };
  }

  /**
   * Rotates the inbound webhook signing secret. The previous secret stops
   * verifying immediately; the new value is returned exactly once.
   */
  async rotateSecret(_actor: RequestActor, accountId: string): Promise<{ signingSecret: string }> {
    const prisma = getPrisma();
    const account = await prisma.leadSourceAccount.findFirst({
      where: { id: accountId },
    });
    if (!account) throw errors.notFound("Source account not found.");

    const secret = `whsec_${randomToken(24)}`;
    const existing = await prisma.integrationCredential.findFirst({
      where: { sourceAccountId: accountId, type: "WEBHOOK_HMAC" },
    });
    if (existing) {
      await prisma.integrationCredential.update({
        where: { id: existing.id },
        data: { secret: encryptSecret(secret), rotatedAt: new Date() },
      });
    } else {
      await prisma.integrationCredential.create({
        data: {
          sourceAccountId: accountId,
          type: "WEBHOOK_HMAC",
          secret: encryptSecret(secret),
          meta: { header: "x-signature" },
        },
      });
    }

    await this.audit.record({
      action: "source.account.secret.rotated",
      entityType: "LeadSourceAccount",
      entityId: accountId,
      metadata: { previousExisted: existing !== null },
    });
    return { signingSecret: secret };
  }

  // --- Lookup helpers (used by the webhook ingress) ---------------------------

  async getAccountByPublicId(publicId: string) {
    const account = await getPrisma().leadSourceAccount.findUnique({
      where: { publicId },
      include: { source: true },
    });
    if (!account) throw new AppError("SOURCE_ACCOUNT_NOT_FOUND", "Webhook source account not found.");
    return account;
  }

  /** Decrypted inbound signing secret, when one is configured. */
  async getInboundSecret(accountId: string): Promise<string | null> {
    const credential = await getPrisma().integrationCredential.findFirst({
      where: { sourceAccountId: accountId, type: "WEBHOOK_HMAC" },
    });
    if (!credential) return null;
    const { decryptSecret } = await import("@middleware/shared");
    return decryptSecret(credential.secret);
  }
}

/** Stable idempotency key for an inbound webhook event. */
export function webhookIdempotencyKey(accountId: string, externalEventId: string | null, rawBody: string): string {
  const basis = externalEventId && externalEventId !== "" ? `evt:${externalEventId}` : `body:${sha256Hex(rawBody)}`;
  return sha256Hex(`${accountId}:${basis}`);
}
