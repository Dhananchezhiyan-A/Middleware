import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@middleware/config";
import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";
import { AppError } from "@middleware/shared";
import type { RequestActor } from "@middleware/types";
import { AuditService } from "../../apps/api/src/infra/audit.module";
import type { QueuesService } from "../../apps/api/src/infra/redis.module";
import { LeadSelectionStore } from "../../apps/api/src/infra/selection.store";
import { DeliveriesService } from "../../apps/api/src/modules/deliveries/deliveries.service";
import { LeadsService } from "../../apps/api/src/modules/leads/leads.service";
import {
  ManualSendService,
  type ManualSendResult,
} from "../../apps/api/src/modules/leads/manual-send.service";
import { cleanupFixture, createFixture, unique, type Fixture } from "./helpers";

/**
 * MANUAL MULTI-CRM DELIVERY (permanent suite).
 *
 * A. Server-side date/time filtering on `receivedAt` resolved in
 *    APP_TIMEZONE (inclusive boundaries, quick ranges, combined filters,
 *    cursor-stable `total`).
 * B. Server-side selection snapshots: opaque expiring token in REAL Redis,
 *    session-bound, consumed on send, leads created after the selection are
 *    never included, deleted leads are skipped.
 * C. Manual send: multi×multi fan-out through the existing delivery
 *    pipeline, inactive destinations rejected BEFORE any write, repeat
 *    sends idempotent, mapping fail-fast, correlation-scoped stats/list,
 *    audit row.
 *
 * Real PostgreSQL + real Redis; the queue producer is stubbed on purpose
 * (queue mechanics are `pnpm test:queue`) and destination URLs point at
 * 127.0.0.1:9 — nothing can reach an external CRM from here.
 */

interface QueuedJob {
  deliveryId: string;
  leadId: string;
  destinationId: string;
  correlationId?: string;
}

interface LeadRow {
  id: string;
}

describe("lead filtering, selection snapshots and manual send", () => {
  let db: Database;
  let fx: Fixture;
  let actor: RequestActor;
  let store: LeadSelectionStore;
  let leadsSvc: LeadsService;
  let deliveriesSvc: DeliveriesService;
  let manualSend: ManualSendService;

  const queuedJobs: QueuedJob[] = [];
  const tokens: string[] = [];
  const submissionIds: string[] = [];

  let destA: string;
  let destAName: string;
  let destB: string;
  let destBName: string;
  let destC: string;
  let destCName: string;
  let destD: string;

  // --- fixture leads, one controlled receivedAt each -------------------------
  let l1: LeadRow; // 2026-03-15 10:00 IST — inside the IST day
  let l2: LeadRow; // 2026-03-15 23:59:59.999 IST — last millisecond of it
  let l3: LeadRow; // 2026-03-16 00:00:00 IST — first instant of the next day
  let p1: LeadRow; // 2026-03-20, for cursor-paged totals
  let p2: LeadRow;
  let p3: LeadRow;
  let s1: LeadRow; // 2026-03-25, for selection snapshots
  let s2: LeadRow;
  let s3: LeadRow;
  let x1: LeadRow; // 2026-03-26, for the send scenarios
  let x2: LeadRow;
  let x3: LeadRow;
  let n1: LeadRow; // received now → covered by quick ranges
  let o1: LeadRow; // 10 days ago → last30 yes, last7 no

  async function newLead(receivedAt: Date, status?: "RECEIVED" | "PROCESSED"): Promise<LeadRow> {
    return db.lead.create({
      data: {
        sourceId: fx.sourceId,
        sourceAccountId: fx.accountId,
        externalLeadId: unique("lead"),
        canonicalData: { email: `${unique("lead")}@itest.local`, name: { full: "Integration Lead" } },
        receivedAt,
        ...(status ? { status } : {}),
      },
    });
  }

  async function expectFailure(promise: Promise<unknown>, code: string): Promise<AppError> {
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(code);
      return err as AppError;
    }
    throw new Error(`Expected the call to fail with ${code} but it resolved.`);
  }

  async function listLeads(query: Record<string, unknown>): Promise<{
    items: Array<{ id: string }>;
    total: number;
    nextCursor: string | null;
  }> {
    return (await leadsSvc.list(actor, query as never)) as never;
  }

  const idsOf = (page: { items: LeadRow[] }): string[] => page.items.map((r) => r.id).sort();

  beforeAll(async () => {
    db = getPrisma();
    fx = await createFixture(db);
    destA = fx.destinationId;
    destAName = (await db.destination.findUniqueOrThrow({ where: { id: destA } })).name;

    const mk = async (name: string, status: "ACTIVE" | "DISABLED") =>
      db.destination.create({
        data: {
          type: "WEBHOOK",
          name: unique(name),
          status,
          config: { url: "http://127.0.0.1:9/never-called" },
        },
      });
    const b = await mk("DestB", "ACTIVE");
    destB = b.id;
    destBName = b.name;
    const c = await mk("DestC", "DISABLED");
    destC = c.id;
    destCName = c.name;
    const d = await mk("DestD", "ACTIVE");
    destD = d.id;

    // Real user — the audit row's actorId FKs to User.
    const role = await db.role.create({ data: { name: unique("ManualSend Tester"), permissions: [] } });
    const user = await db.user.create({
      data: {
        roleId: role.id,
        email: `${unique("msend")}@itest.local`,
        passwordHash: "itest-hash",
        name: "Manual Send Tester",
      },
    });
    actor = {
      userId: user.id,
      email: user.email,
      role: "Owner",
      permissions: ["leads:read", "leads:replay"],
      sessionId: "itest-session",
      actorType: "USER",
      correlationId: "itest-manual-send",
    };

    store = new LeadSelectionStore();
    leadsSvc = new LeadsService({} as never, {} as never);
    deliveriesSvc = new DeliveriesService({} as never, {} as never);
    manualSend = new ManualSendService(
      db,
      new AuditService(),
      {
        enqueueDelivery: async (job: QueuedJob) => {
          queuedJobs.push(job);
        },
      } as unknown as QueuesService,
      store,
    );

    // --- controlled receivedAt values (UTC instants) -------------------------
    l1 = await newLead(new Date("2026-03-15T04:30:00.000Z"), "RECEIVED");
    l2 = await newLead(new Date("2026-03-15T18:29:59.999Z"), "PROCESSED");
    l3 = await newLead(new Date("2026-03-15T18:30:00.000Z"));
    p1 = await newLead(new Date("2026-03-20T04:00:00.000Z"));
    p2 = await newLead(new Date("2026-03-20T05:00:00.000Z"));
    p3 = await newLead(new Date("2026-03-20T06:00:00.000Z"));
    s1 = await newLead(new Date("2026-03-25T04:00:00.000Z"));
    s2 = await newLead(new Date("2026-03-25T05:00:00.000Z"));
    s3 = await newLead(new Date("2026-03-25T06:00:00.000Z"));
    x1 = await newLead(new Date("2026-03-26T04:00:00.000Z"));
    x2 = await newLead(new Date("2026-03-26T05:00:00.000Z"));
    x3 = await newLead(new Date("2026-03-26T06:00:00.000Z"));
    n1 = await newLead(new Date());
    o1 = await newLead(new Date(Date.now() - 10 * 86_400_000));
  });

  afterAll(async () => {
    for (const token of tokens) {
      try {
        await store.delete(token);
      } catch {
        // Redis may already be down at teardown; nothing to leak beyond TTL.
      }
    }
    store.onModuleDestroy();
    await db.auditLog.deleteMany({
      where: { action: "delivery.manual_send", entityId: { in: submissionIds } },
    });
    await cleanupFixture(fx, db);
  });

  // ===========================================================================
  // A. Server-side date/time filtering
  // ===========================================================================

  describe("server-side date/time filtering on receivedAt", () => {
    it("runs against the configured APP_TIMEZONE", () => {
      // The boundaries below are IST-specific; fail loudly if .env changes.
      expect(getEnv().APP_TIMEZONE).toBe("Asia/Kolkata");
    });

    it("treats a single date as the full zoned day, inclusive on both ends", async () => {
      const page = await listLeads({
        dateFrom: "2026-03-15",
        dateTo: "2026-03-15",
        sourceId: fx.sourceId,
        limit: 50,
      });
      // l2 sits on the last millisecond of the IST day → included.
      // l3 is 2026-03-16T00:00 IST (still 2026-03-15 in UTC) → excluded.
      expect(idsOf(page)).toEqual([l1.id, l2.id].sort());
      expect(idsOf(page)).not.toContain(l3.id); // next IST day is out
      expect(page.total).toBe(2);
    });

    it("honours explicit start/end times (inclusive to the minute)", async () => {
      const page = await listLeads({
        dateFrom: "2026-03-15",
        timeFrom: "23:59",
        dateTo: "2026-03-15",
        timeTo: "23:59",
        sourceId: fx.sourceId,
        limit: 50,
      });
      expect(idsOf(page)).toEqual([l2.id]);
      expect(page.total).toBe(1);
    });

    it("rejects an inverted date range instead of matching everything", async () => {
      const err = await expectFailure(
        listLeads({
          dateFrom: "2026-03-16",
          dateTo: "2026-03-15",
          sourceId: fx.sourceId,
          limit: 10,
        }),
        "VALIDATION_FAILED",
      );
      expect(err.message.length).toBeGreaterThan(0);
    });

    it("combines the date range with status and source filters", async () => {
      const page = await listLeads({
        dateFrom: "2026-03-15",
        dateTo: "2026-03-15",
        status: "RECEIVED",
        sourceId: fx.sourceId,
        limit: 50,
      });
      // l2 is PROCESSED → dropped by the status filter; l3 is out of range.
      expect(idsOf(page)).toEqual([l1.id]);
      expect(page.total).toBe(1);
    });

    it("resolves quick ranges to calendar days in APP_TIMEZONE", async () => {
      const today = await listLeads({ quickRange: "today", sourceId: fx.sourceId, limit: 50 });
      expect(idsOf(today)).toEqual([n1.id]);

      const last7 = await listLeads({ quickRange: "last7", sourceId: fx.sourceId, limit: 50 });
      expect(idsOf(last7)).toEqual([n1.id]); // o1 is 10 days old

      const last30 = await listLeads({ quickRange: "last30", sourceId: fx.sourceId, limit: 50 });
      expect(idsOf(last30)).toEqual([n1.id, o1.id].sort());
      expect(last30.total).toBe(2);
    });

    it("keeps total equal to the full filtered set across cursor pages", async () => {
      const page1 = await listLeads({
        dateFrom: "2026-03-20",
        dateTo: "2026-03-20",
        sourceId: fx.sourceId,
        limit: 2,
        sort: "receivedAt:asc",
      });
      expect(page1.items.map((r) => r.id)).toEqual([p1.id, p2.id]);
      expect(page1.total).toBe(3);
      expect(page1.nextCursor).toBeTruthy();

      const page2 = await listLeads({
        dateFrom: "2026-03-20",
        dateTo: "2026-03-20",
        sourceId: fx.sourceId,
        limit: 2,
        sort: "receivedAt:asc",
        cursor: page1.nextCursor,
      });
      expect(page2.items.map((r) => r.id)).toEqual([p3.id]);
      expect(page2.total).toBe(3); // NOT the remaining count
      expect(page2.nextCursor).toBeNull();
    });
  });

  // ===========================================================================
  // B. Selection snapshots (real Redis)
  // ===========================================================================

  describe("selection snapshots in Redis", () => {
    it("resolves the filters into an opaque, expiring, session-bound token", async () => {
      const res = await manualSend.createSelection(actor, {
        dateFrom: "2026-03-25",
        dateTo: "2026-03-25",
      });
      tokens.push(res.token);
      expect(res.count).toBe(3);
      expect(res.mode).toBe("filtered");
      expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const record = await store.get(res.token);
      expect(record).not.toBeNull();
      if (!record) throw new Error("selection record missing from Redis");
      expect([...record.ids].sort()).toEqual([s1.id, s2.id, s3.id].sort());
      expect(record.actorId).toBe(actor.userId);
      expect(record.mode).toBe("filtered");
      expect(record.filters).toMatchObject({ dateFrom: "2026-03-25", dateTo: "2026-03-25" });
    });

    it("never includes leads created after the selection was taken", async () => {
      const res = await manualSend.createSelection(actor, {
        dateFrom: "2026-03-25",
        dateTo: "2026-03-25",
      });
      tokens.push(res.token);

      // Matches the same filters — but arrived AFTER the snapshot.
      const s4 = await newLead(new Date("2026-03-25T07:00:00.000Z"));

      const preview = await manualSend.preview(actor, {
        selectionToken: res.token,
        destinationIds: [destA],
      });
      expect(preview.leadCount).toBe(3);
      expect(preview.eligible).toBe(3);

      const sent = await manualSend.send(actor, {
        selectionToken: res.token,
        destinationIds: [destA],
      });
      submissionIds.push(sent.submissionId);
      expect(sent.created).toBe(3);
      expect(sent.leadCount).toBe(3);

      const s4Deliveries = await db.delivery.count({ where: { leadId: s4.id } });
      expect(s4Deliveries).toBe(0);

      // The token was consumed by the completed run.
      expect(await store.get(res.token)).toBeNull();
    });

    it("refuses a token created for a different session", async () => {
      const res = await manualSend.createSelection(actor, {
        dateFrom: "2026-03-25",
        dateTo: "2026-03-25",
      });
      tokens.push(res.token);
      expect(res.count).toBe(4); // s1..s4 now

      await expectFailure(
        manualSend.send(
          { ...actor, userId: "some-other-user", sessionId: "other-session" },
          { selectionToken: res.token, destinationIds: [destA] },
        ),
        "FORBIDDEN",
      );
      // Not consumed by the failed attempt.
      expect(await store.get(res.token)).not.toBeNull();
    });

    it("treats consumed and unknown tokens as conflicts, never a re-send", async () => {
      // Consumed by the earlier successful send.
      const consumed = tokens[1];
      const err = await expectFailure(
        manualSend.send(actor, { selectionToken: consumed, destinationIds: [destA] }),
        "CONFLICT",
      );
      expect(err.message).toMatch(/expired or was already sent/i);

      await expectFailure(
        manualSend.send(actor, {
          selectionToken: "tok_aaaaaaaaaaaaaaaaaaaaaaaa",
          destinationIds: [destA],
        }),
        "CONFLICT",
      );
      await expectFailure(
        manualSend.send(actor, { selectionToken: "short", destinationIds: [destA] }),
        "BAD_REQUEST",
      );
    });

    it("refuses an empty lead ID list (never 'send everything')", async () => {
      await expectFailure(
        manualSend.send(actor, { leadIds: [], destinationIds: [destA] }),
        "BAD_REQUEST",
      );
    });
  });

  // ===========================================================================
  // C. Manual send (multi × multi through the existing pipeline)
  // ===========================================================================

  describe("manual multi-destination send", () => {
    let firstSend: ManualSendResult;

    it("rejects inactive destinations before writing anything", async () => {
      const before = await db.delivery.count({
        where: { leadId: { in: [x1.id, x2.id] }, destinationId: { in: [destA, destC] } },
      });
      expect(before).toBe(0);

      const err = await expectFailure(
        manualSend.send(actor, { leadIds: [x1.id, x2.id], destinationIds: [destA, destC] }),
        "VALIDATION_FAILED",
      );
      expect(err.message).toContain(destCName);
      expect(err.message).toMatch(/not active/i);

      const after = await db.delivery.count({
        where: { leadId: { in: [x1.id, x2.id] }, destinationId: { in: [destA, destC] } },
      });
      expect(after).toBe(0);
    });

    it("previews authoritative counts without creating anything", async () => {
      const preview = await manualSend.preview(actor, {
        leadIds: [x1.id, x2.id, x3.id],
        destinationIds: [destA, destB],
      });

      expect(preview.leadCount).toBe(3);
      expect(preview.combinations).toBe(6);
      expect(preview.eligible).toBe(6);
      expect(preview.skippedExisting).toBe(0);
      expect(preview.missingLeads).toBe(0);
      expect(preview.destinations).toHaveLength(2);
      expect(preview.limits.maxLeads).toBe(getEnv().LEAD_SELECTION_MAX);
      expect(preview.limits.maxCombinations).toBe(getEnv().MANUAL_SEND_MAX_DELIVERIES);

      const rows = await db.delivery.count({ where: { leadId: { in: [x1.id, x2.id, x3.id] } } });
      expect(rows).toBe(0);
    });

    it("queues exactly one delivery per lead × destination", async () => {
      firstSend = await manualSend.send(actor, {
        leadIds: [x1.id, x2.id, x3.id],
        destinationIds: [destA, destB],
      });
      submissionIds.push(firstSend.submissionId);

      expect(firstSend.created).toBe(6);
      expect(firstSend.combinations).toBe(6);
      expect(firstSend.skipped).toBe(0);
      expect(firstSend.failed).toBe(0);
      expect(firstSend.enqueueFailures).toBe(0);
      expect(firstSend.destinations.map((d) => d.id).sort()).toEqual([destA, destB].sort());

      const rows = await db.delivery.findMany({
        where: { correlationId: firstSend.submissionId },
      });
      expect(rows).toHaveLength(6);
      const pairs = new Set(rows.map((r) => `${r.leadId}:${r.destinationId}`));
      expect(pairs.size).toBe(6);
      for (const row of rows) {
        expect(row.status).toBe("QUEUED");
        expect(row.enqueuedAt).toBeInstanceOf(Date);
        expect(row.maxAttempts).toBe(getEnv().DELIVERY_MAX_ATTEMPTS);
        expect(row.mappedPayload).not.toBeNull(); // pass-through snapshot
      }

      const jobs = queuedJobs.filter((j) => j.correlationId === firstSend.submissionId);
      expect(jobs).toHaveLength(6);
      const rowIds = new Set(rows.map((r) => r.id));
      for (const job of jobs) expect(rowIds.has(job.deliveryId)).toBe(true);
    });

    it("previews as fully skipped once the pairs exist", async () => {
      const preview = await manualSend.preview(actor, {
        leadIds: [x1.id, x2.id, x3.id],
        destinationIds: [destA, destB],
      });
      expect(preview.eligible).toBe(0);
      expect(preview.skippedExisting).toBe(6);
    });

    it("makes a repeat submission a no-op (no duplicate rows or jobs)", async () => {
      const repeat = await manualSend.send(actor, {
        leadIds: [x1.id, x2.id, x3.id],
        destinationIds: [destA, destB],
      });
      submissionIds.push(repeat.submissionId);

      expect(repeat.created).toBe(0);
      expect(repeat.skippedExisting).toBe(6);
      expect(repeat.skipped).toBe(6);

      const total = await db.delivery.count({ where: { leadId: { in: [x1.id, x2.id, x3.id] } } });
      expect(total).toBe(6); // unchanged
      const repeatJobs = queuedJobs.filter((j) => j.correlationId === repeat.submissionId);
      expect(repeatJobs).toHaveLength(0);
    });

    it("skips leads deleted since the selection was made", async () => {
      const y1 = await newLead(new Date("2026-03-26T07:00:00.000Z"));
      const y2 = await newLead(new Date("2026-03-26T08:00:00.000Z"));
      await db.lead.delete({ where: { id: y2.id } });

      const result = await manualSend.send(actor, {
        leadIds: [y1.id, y2.id],
        destinationIds: [destA],
      });
      submissionIds.push(result.submissionId);

      expect(result.created).toBe(1);
      expect(result.missingLeads).toBe(1);
      expect(result.skippedMissingLeads).toBe(1);
      expect(result.skippedExisting).toBe(0);

      const row = await db.delivery.findFirst({ where: { leadId: y1.id, destinationId: destA } });
      expect(row?.correlationId).toBe(result.submissionId);
    });

    it("fails fast when required mapping fields are missing (REJECTED, no job)", async () => {
      // Active mapping with one required source the lead data does not have.
      const mapping = await db.fieldMapping.create({
        data: { destinationId: destD, name: unique("Strict map"), status: "ACTIVE" },
      });
      const version = await db.fieldMappingVersion.create({
        data: {
          mappingId: mapping.id,
          version: 1,
          fields: [
            { source: "email", target: "Email" },
            { source: "custom.missing", target: "Company", required: true },
          ],
        },
      });
      await db.fieldMapping.update({
        where: { id: mapping.id },
        data: { activeVersionId: version.id },
      });

      const result = await manualSend.send(actor, {
        leadIds: [x1.id],
        destinationIds: [destD],
      });
      submissionIds.push(result.submissionId);

      expect(result.failed).toBe(1);
      expect(result.created).toBe(0);

      const row = await db.delivery.findFirst({
        where: { leadId: x1.id, destinationId: destD },
      });
      expect(row?.status).toBe("FAILED");
      expect(row?.errorCode).toBe("DESTINATION_REJECTED");
      expect(row?.errorMessage).toContain("custom.missing");
      if (!row) throw new Error("failed delivery row missing");

      const attempt = await db.deliveryAttempt.findFirstOrThrow({
        where: { deliveryId: row.id },
      });
      expect(attempt.status).toBe("REJECTED");
      expect(attempt.errorCategory).toBe("MAPPING");
      expect(attempt.workerId).toBe("api-manual-send");

      const jobs = queuedJobs.filter((j) => j.correlationId === result.submissionId);
      expect(jobs).toHaveLength(0);
    });

    it("reports the submission accurately through stats and the deliveries list", async () => {
      const stats = await deliveriesSvc.stats(firstSend.submissionId);
      expect(stats.total).toBe(6);
      expect(stats.byStatus.QUEUED).toBe(6);
      expect(stats.byStatus.SUCCEEDED).toBe(0);
      expect(stats.destinations).toHaveLength(2);
      const byId = new Map(stats.destinations.map((d) => [d.id, d]));
      expect(byId.get(destA)?.byStatus.QUEUED).toBe(3);
      expect(byId.get(destB)?.byStatus.QUEUED).toBe(3);
      expect([byId.get(destA)?.name, byId.get(destB)?.name].sort()).toEqual(
        [destAName, destBName].sort(),
      );

      const list = (await deliveriesSvc.list({
        correlationId: firstSend.submissionId,
        limit: 50,
      })) as unknown as { items: Array<{ correlationId: string | null }> };
      expect(list.items).toHaveLength(6);
      for (const item of list.items) expect(item.correlationId).toBe(firstSend.submissionId);

      await expectFailure(deliveriesSvc.stats("not a valid id!"), "VALIDATION_FAILED");
    });

    it("records an audit row for the manual send", async () => {
      const row = await db.auditLog.findFirst({
        where: { action: "delivery.manual_send", entityId: firstSend.submissionId },
      });
      expect(row).not.toBeNull();
      if (!row) throw new Error("audit row missing");
      expect(row.actorId).toBe(actor.userId);
      expect(row.entityType).toBe("Delivery");
      const metadata = row.metadata as Record<string, unknown>;
      expect(metadata).toMatchObject({
        mode: "page",
        leadCount: 3,
        combinations: 6,
        created: 6,
        skippedExisting: 0,
      });
    });
  });
});
