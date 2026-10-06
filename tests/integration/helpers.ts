import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";

/**
 * Shared fixtures for the DB-backed integration suite.
 *
 * These tests run against the REAL `middleware` PostgreSQL database (the only
 * database the app is allowed to touch — see assertSafeDatabaseUrl). The
 * application is single-identity, so fixtures no longer scope a tenant column:
 * rows are isolated by the unique codes/names/emails created here (all carry
 * the RUN marker) and by the fixture graph (source → leads → deliveries).
 * `cleanupFixture` removes everything again in FK-safe order.
 */

/** Unique run marker embedded in every fixture name/code/email. */
export const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let seq = 0;
/** Unique suffix for fixture names (monotonic within a process). */
export function unique(label: string): string {
  seq += 1;
  return `${label}-${RUN}-${seq}`;
}

export interface Fixture {
  sourceId: string;
  accountId: string;
  destinationId: string;
}

/**
 * Creates a webhook source + source account + destination. Everything a test
 * creates hangs off these rows (leads under the source, deliveries under the
 * destination), so cleanup can walk the graph back from them.
 */
export async function createFixture(
  db: Database = getPrisma(),
  overrides: { destinationStatus?: "ACTIVE" | "DISABLED" } = {},
): Promise<Fixture> {
  const source = await db.leadSource.create({
    data: { type: "WEBHOOK", code: unique("src"), name: unique("Source") },
  });
  const account = await db.leadSourceAccount.create({
    data: { sourceId: source.id, name: unique("Account"), publicId: unique("pub") },
  });
  const destination = await db.destination.create({
    data: {
      type: "WEBHOOK",
      name: unique("Destination"),
      status: overrides.destinationStatus ?? "ACTIVE",
      config: { url: "http://127.0.0.1:9/never-called" },
    },
  });
  return { sourceId: source.id, accountId: account.id, destinationId: destination.id };
}

/**
 * Removes this run's fixture rows and everything the tests created around
 * them, in FK-safe order.
 *
 * Scoping strategy (there is no tenant column to filter on anymore):
 *   - business rows hang off the fixture graph (source → leads → deliveries),
 *   - auxiliary rows (rules, destinations, roles, users) carry the RUN marker
 *     in their unique name/code/email — see `unique()`.
 * Rows are deleted explicitly so the test never depends on cascade ordering.
 */
export async function cleanupFixture(fx: Fixture, db: Database = getPrisma()): Promise<void> {
  // --- collect the RUN-scoped graph -----------------------------------------
  const sources = await db.leadSource.findMany({
    where: { OR: [{ id: fx.sourceId }, { name: { contains: RUN } }, { code: { contains: RUN } }] },
    select: { id: true },
  });
  const sourceIds = sources.map((r) => r.id);
  const accounts = await db.leadSourceAccount.findMany({
    where: { OR: [{ id: fx.accountId }, { sourceId: { in: sourceIds } }] },
    select: { id: true },
  });
  const accountIds = accounts.map((r) => r.id);
  const leads = await db.lead.findMany({ where: { sourceId: { in: sourceIds } }, select: { id: true } });
  const leadIds = leads.map((r) => r.id);
  const destinations = await db.destination.findMany({
    where: { OR: [{ id: fx.destinationId }, { name: { contains: RUN } }] },
    select: { id: true },
  });
  const destinationIds = destinations.map((r) => r.id);
  const deliveries = await db.delivery.findMany({
    where: { OR: [{ leadId: { in: leadIds } }, { destinationId: { in: destinationIds } }] },
    select: { id: true },
  });
  const deliveryIds = deliveries.map((r) => r.id);
  const rules = await db.routingRule.findMany({
    where: { name: { contains: RUN } },
    select: { id: true },
  });
  const ruleIds = rules.map((r) => r.id);
  const users = await db.user.findMany({
    where: { email: { contains: RUN } },
    select: { id: true },
  });
  const userIds = users.map((r) => r.id);

  // --- children first (never depend on cascade ordering) --------------------
  await db.deliveryAttempt.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { entityId: { in: [...leadIds, ...deliveryIds, ...sourceIds, ...accountIds, ...destinationIds] } },
        { actorId: { in: userIds } },
        // Test-only actions written by audit.test.ts (never produced by the app).
        { action: { in: ["test.action", "secret.test", "append.test"] } },
      ],
    },
  });
  await db.delivery.deleteMany({ where: { id: { in: deliveryIds } } });
  await db.leadStageEvent.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.leadScore.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.leadDuplicate.deleteMany({
    where: { OR: [{ leadId: { in: leadIds } }, { originalLeadId: { in: leadIds } }] },
  });
  await db.routingResult.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.leadProcessing.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.leadRawPayload.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.lead.deleteMany({ where: { id: { in: leadIds } } });
  await db.webhookEvent.deleteMany({
    where: { OR: [{ sourceId: { in: sourceIds } }, { sourceAccountId: { in: accountIds } }] },
  });
  await db.routingRuleDestination.deleteMany({
    where: { OR: [{ ruleId: { in: ruleIds } }, { destinationId: { in: destinationIds } }] },
  });
  await db.routingRule.deleteMany({ where: { id: { in: ruleIds } } });
  await db.fieldMappingVersion.deleteMany({
    where: { mapping: { destinationId: { in: destinationIds } } },
  });
  await db.fieldMapping.deleteMany({ where: { destinationId: { in: destinationIds } } });
  await db.destinationHealth.deleteMany({ where: { destinationId: { in: destinationIds } } });
  await db.integrationCredential.deleteMany({ where: { destinationId: { in: destinationIds } } });
  await db.destination.deleteMany({ where: { id: { in: destinationIds } } });
  await db.leadSourceAccount.deleteMany({ where: { id: { in: accountIds } } });
  await db.leadSource.deleteMany({ where: { id: { in: sourceIds } } });
  await db.apiKey.deleteMany({ where: { userId: { in: userIds } } });
  await db.userSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.role.deleteMany({ where: { name: { contains: RUN } } });

  // DeduplicationConfig is an app-wide singleton now: restore its defaults
  // (pipeline.test.ts flips it on with an EMAIL strategy).
  await db.deduplicationConfig.updateMany({
    data: { enabled: false, strategy: "PHONE", matchFields: [] },
  });

  // Purge tenant rows left behind by pre-refactor fixture versions (their
  // column-scoped cleanup no longer exists). The seeded application row
  // ("Demo Workspace") never matches this prefix.
  await db.tenant.deleteMany({ where: { name: { startsWith: "Integration Tenant" } } });
}
