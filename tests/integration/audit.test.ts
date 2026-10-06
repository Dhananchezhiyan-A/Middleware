import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "../../apps/api/src/infra/audit.module";
import { runWithContext, sanitizeDeep } from "@middleware/shared";
import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";
import { cleanupFixture, createFixture, unique, type Fixture } from "./helpers";

/**
 * AUDIT TRAIL.
 *
 * Audit rows are append-only evidence: secrets are stripped before insert, the
 * schema carries no @updatedAt (so nothing rewrites history), and a failed
 * audit write must never break the business operation that triggered it.
 */
describe("audit trail (real PostgreSQL)", () => {
  let db: Database;
  let fx: Fixture;
  const audit = new AuditService();

  beforeAll(async () => {
    db = getPrisma();
    fx = await createFixture(db);
  });

  afterAll(async () => {
    await cleanupFixture(fx, db);
  });

  it("records an action with actor and correlation id from the context", async () => {
    // actorId is a real FK to User — AuditService deliberately swallows the
    // write when it is bogus, so we create the user first.
    const role = await db.role.create({
      data: { name: unique("Audit Role"), permissions: [] },
    });
    const user = await db.user.create({
      data: {
        roleId: role.id,
        email: unique("audit@example.com"),
        passwordHash: "not-used",
        name: "Audit Actor",
      },
    });

    await runWithContext(
      {
        correlationId: "audit-correlation-1",
        actorType: "USER",
        userId: user.id,
      },
      async () => audit.record({ action: "test.action", entityType: "Source", entityId: fx.sourceId }),
    );

    const row = await db.auditLog.findFirst({
      where: { correlationId: "audit-correlation-1" },
    });
    expect(row).not.toBeNull();
    expect(row?.action).toBe("test.action");
    expect(row?.entityType).toBe("Source");
    expect(row?.actorType).toBe("USER");
    expect(row?.actorId).toBe(user.id);
  });

  it("strips secrets from before/after/metadata before persistence", async () => {
    await audit.record({
      action: "secret.test",
      entityType: "IntegrationCredential",
      before: { apiKey: "OLD-PLAINTEXT", nested: { clientSecret: "OLD-SECRET" } },
      after: { apiKey: "NEW-PLAINTEXT" },
      metadata: { authorization: "Bearer xyz", password: "hunter2", body: "ok" },
    });

    const row = await db.auditLog.findFirst({
      where: { action: "secret.test" },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    const after = row?.after as Record<string, unknown>;
    const before = row?.before as Record<string, unknown>;
    const meta = row?.metadata as Record<string, unknown>;

    expect(after.apiKey).toBe("[REDACTED]");
    expect(before.apiKey).toBe("[REDACTED]");
    expect((before.nested as Record<string, unknown>).clientSecret).toBe("[REDACTED]");
    expect(meta.authorization).toBe("[REDACTED]");
    expect(meta.password).toBe("[REDACTED]");
    expect(meta.body).toBe("ok"); // non-sensitive values are preserved verbatim

    // Nothing resembling the plaintext ever reaches the row.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("OLD-PLAINTEXT");
    expect(serialized).not.toContain("NEW-PLAINTEXT");
    expect(serialized).not.toContain("OLD-SECRET");
    expect(serialized).not.toContain("Bearer xyz");
    expect(serialized).not.toContain("hunter2");
  });

  it("sanitizeDeep is the reason (unit-level proof of the redaction rule)", () => {
    const out = sanitizeDeep({ refreshToken: "rt", apiKeyId: "id", keep: "yes" }) as Record<string, unknown>;
    expect(out.refreshToken).toBe("[REDACTED]");
    expect(out.apiKeyId).toBe("[REDACTED]");
    expect(out.keep).toBe("yes");
  });

  it("is append-only: the AuditLog table has no updated_at column", async () => {
    const cols = await db.$queryRaw<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'AuditLog' order by column_name`;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("createdAt");
    expect(names).toContain("before");
    expect(names).toContain("after");
    expect(names).not.toContain("updatedAt");
    expect(names).not.toContain("updated_at");
  });

  it("never overwrites an existing row — re-recording appends a new row", async () => {
    const before = await db.auditLog.count({ where: { action: "append.test" } });
    await audit.record({ action: "append.test", entityType: "Test" });
    await audit.record({ action: "append.test", entityType: "Test" });
    const after = await db.auditLog.count({ where: { action: "append.test" } });
    expect(after - before).toBe(2);
  });

  it("an audit failure never breaks the operation that triggered it", async () => {
    // Bogus actor id → FK violation (ActorLog.actor → User) inside
    // AuditService.record(). The contract is: log it loudly, do NOT throw.
    await expect(
      audit.record({
        actorId: "user-does-not-exist",
        action: "audit.failure.test",
        entityType: "Test",
      }),
    ).resolves.toBeUndefined();

    const row = await db.auditLog.findFirst({ where: { action: "audit.failure.test" } });
    expect(row).toBeNull();
  });

  it("stage events are append-only too (no updated_at on LeadStageEvent)", async () => {
    const cols = await db.$queryRaw<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'LeadStageEvent' order by column_name`;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("startedAt");
    expect(names).toContain("finishedAt");
    expect(names).not.toContain("updatedAt");
  });

  it("delivery attempts are append-only evidence (no updated_at)", async () => {
    const cols = await db.$queryRaw<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'DeliveryAttempt' order by column_name`;
    expect(cols.map((c) => c.column_name)).not.toContain("updatedAt");
  });
});
