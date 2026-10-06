import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";
import { cleanupFixture, createFixture, unique, type Fixture } from "./helpers";

/**
 * DATABASE-LEVEL IDEMPOTENCY.
 *
 * Every unique constraint below is the last line of defence against duplicate
 * work when a job is retried, a webhook is replayed, or two workers race.
 * Application code handles P2002 gracefully (see WebhooksService.ingress and
 * DeliveryService.recordAttempt) — these tests prove the constraint exists and
 * actually rejects the duplicate.
 */
describe("unique-constraint idempotency (real PostgreSQL)", () => {
  let db: Database;
  let fx: Fixture;
  let other: Fixture;

  beforeAll(async () => {
    db = getPrisma();
    fx = await createFixture(db);
    other = await createFixture(db);
  });

  afterAll(async () => {
    await cleanupFixture(fx, db);
    await cleanupFixture(other, db);
  });

  async function expectUniqueViolation(fn: () => Promise<unknown>): Promise<void> {
    let code: string | undefined;
    try {
      await fn();
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe("P2002");
  }

  it("webhook events: same (account, idempotencyKey) is stored once", async () => {
    const key = "idem-webhook-1";
    await db.webhookEvent.create({
      data: {
        sourceAccountId: fx.accountId,
        sourceId: fx.sourceId,
        externalEventId: "evt-1",
        idempotencyKey: key,
        status: "PROCESSED",
        payload: { a: 1 },
      },
    });
    await expectUniqueViolation(() =>
      db.webhookEvent.create({
        data: {
          sourceAccountId: fx.accountId,
          sourceId: fx.sourceId,
          externalEventId: "evt-1",
          idempotencyKey: key,
          status: "RECEIVED",
          payload: { a: 2 },
        },
      }),
    );

    // Exactly one row survives, and it kept the FIRST write (append-only).
    const rows = await db.webhookEvent.findMany({
      where: { sourceAccountId: fx.accountId, idempotencyKey: key },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ a: 1 });

    // A different source account may use the identical key (the account is
    // part of the composite key).
    const cross = await db.webhookEvent.create({
      data: {
        sourceAccountId: other.accountId,
        sourceId: other.sourceId,
        idempotencyKey: key,
        status: "RECEIVED",
        payload: { b: 1 },
      },
    });
    expect(cross.id).toBeTruthy();
  });

  it("leads: same (source account, externalLeadId) is stored once", async () => {
    const externalId = "prov-lead-42";
    await db.lead.create({
      data: {
        sourceId: fx.sourceId,
        sourceAccountId: fx.accountId,
        externalLeadId: externalId,
        canonicalData: { email: "one@example.com" },
      },
    });
    await expectUniqueViolation(() =>
      db.lead.create({
        data: {
          sourceId: fx.sourceId,
          sourceAccountId: fx.accountId,
          externalLeadId: externalId,
          canonicalData: { email: "two@example.com" },
        },
      }),
    );

    // NULL external ids do not collide (Postgres allows many NULLs).
    const nullA = await db.lead.create({
      data: { sourceId: fx.sourceId, sourceAccountId: fx.accountId },
    });
    const nullB = await db.lead.create({
      data: { sourceId: fx.sourceId, sourceAccountId: fx.accountId },
    });
    expect(nullA.id).not.toBe(nullB.id);
  });

  it("deliveries: exactly ONE row per (lead, destination)", async () => {
    const lead = await db.lead.create({
      data: {
        sourceId: fx.sourceId,
        sourceAccountId: fx.accountId,
        canonicalData: { email: "delivery@example.com" },
      },
    });
    await db.delivery.create({
      data: {
        leadId: lead.id,
        destinationId: fx.destinationId,
        status: "QUEUED",
      },
    });
    await expectUniqueViolation(() =>
      db.delivery.create({
        data: {
          leadId: lead.id,
          destinationId: fx.destinationId,
          status: "QUEUED",
        },
      }),
    );
    const count = await db.delivery.count({
      where: { leadId: lead.id },
    });
    expect(count).toBe(1);
  });

  it("delivery attempts: attempt numbers are unique per delivery", async () => {
    const lead = await db.lead.create({
      data: {
        sourceId: fx.sourceId,
        sourceAccountId: fx.accountId,
        canonicalData: { email: "attempt@example.com" },
      },
    });
    const delivery = await db.delivery.create({
      data: {
        leadId: lead.id,
        destinationId: fx.destinationId,
        status: "IN_PROGRESS",
        attemptCount: 1,
      },
    });
    await db.deliveryAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber: 1,
        status: "SUCCEEDED",
        responseStatus: 200,
      },
    });
    await expectUniqueViolation(() =>
      db.deliveryAttempt.create({
        data: {
          deliveryId: delivery.id,
          attemptNumber: 1,
          status: "FAILED",
        },
      }),
    );
    // Attempt 2 is allowed — the sequence itself is not capped by uniqueness.
    const second = await db.deliveryAttempt.create({
      data: {
        deliveryId: delivery.id,
        attemptNumber: 2,
        status: "SUCCEEDED",
      },
    });
    expect(second.attemptNumber).toBe(2);
  });

  it("routing rules: a destination can be attached to a rule only once", async () => {
    const rule = await db.routingRule.create({
      data: { name: unique("idem-rule"), conditions: [] },
    });
    await db.routingRuleDestination.create({
      data: {
        ruleId: rule.id,
        destinationId: fx.destinationId,
        order: 0,
      },
    });
    await expectUniqueViolation(() =>
      db.routingRuleDestination.create({
        data: {
          ruleId: rule.id,
          destinationId: fx.destinationId,
          order: 1,
        },
      }),
    );
  });

  it("identity: tenant slug, API key hash and refresh token hash are unique globally", async () => {
    const slug = unique("slug");
    const slugOwner = await db.tenant.create({ data: { name: "Slug owner", slug } });
    await expectUniqueViolation(() => db.tenant.create({ data: { name: "Dup", slug } }));
    await db.tenant.delete({ where: { id: slugOwner.id } });

    const role = await db.role.create({
      data: { name: `role-${slug}`, permissions: [] },
    });
    const user = await db.user.create({
      data: { roleId: role.id, email: `${unique("idem")}@example.com`, passwordHash: "x", name: "I" },
    });
    await db.apiKey.create({
      data: { userId: user.id, name: "k1", keyPrefix: "mw_", keyHash: "hash-1" },
    });
    await expectUniqueViolation(() =>
      db.apiKey.create({
        data: { userId: user.id, name: "k2", keyPrefix: "mw_", keyHash: "hash-1" },
      }),
    );

    await db.userSession.create({
      data: { userId: user.id, refreshTokenHash: "rt-1", expiresAt: new Date(Date.now() + 1000) },
    });
    await expectUniqueViolation(() =>
      db.userSession.create({
        data: { userId: user.id, refreshTokenHash: "rt-1", expiresAt: new Date(Date.now() + 1000) },
      }),
    );
  });

  it("source code and destination name are globally unique (single application)", async () => {
    // Source codes are application-wide identifiers: a second create with the
    // same code must be rejected — no per-tenant scoping exists anymore.
    const code = unique("shared-code");
    await db.leadSource.create({
      data: { type: "API", code, name: unique("CodeA") },
    });
    await expectUniqueViolation(() =>
      db.leadSource.create({
        data: { type: "API", code, name: unique("CodeB") },
      }),
    );

    const destName = unique("Shared Dest");
    await db.destination.create({
      data: { type: "CUSTOM_API", name: destName, config: {} },
    });
    await expectUniqueViolation(() =>
      db.destination.create({
        data: { type: "CUSTOM_API", name: destName, config: {} },
      }),
    );
  });
});
