import { describe, expect, it, vi, beforeAll } from "vitest";
import { AppError } from "@middleware/shared";
import { getEnv, resetEnvCache } from "@middleware/config";
import type { Database } from "@middleware/database";
import type { RequestActor } from "@middleware/types";
import type { AuditService } from "../../infra/audit.module";
import type { QueuesService } from "../../infra/redis.module";
import type { LeadSelectionStore } from "../../infra/selection.store";
import { ManualSendService, type ManualSendBody } from "./manual-send.service";

/**
 * Manual delivery rules. Every rejection happens BEFORE any delivery row is
 * written or any job is enqueued — the external-call path itself stays in the
 * worker, so these tests never touch a real queue or CRM.
 */

// Tiny, explicit limits so the boundary behaviour is observable.
process.env.LEAD_SELECTION_MAX = "4";
process.env.MANUAL_SEND_MAX_DELIVERIES = "6";

beforeAll(() => {
  resetEnvCache();
});

const ACTOR: RequestActor = {
  userId: "user_1",
  email: "owner@demo.dev",
  role: "Owner",
  permissions: ["leads:read", "leads:replay"],
  sessionId: "session_1",
  actorType: "USER",
  correlationId: "corr_1",
};

const VALID_TOKEN = "tok_0123456789abcdefghij";

interface Harness {
  service: ManualSendService;
  prisma: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
  queues: { enqueueDelivery: ReturnType<typeof vi.fn> };
  audit: { record: ReturnType<typeof vi.fn> };
  selections: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function harness(): Harness {
  const prisma = {
    lead: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    destination: { findMany: vi.fn().mockResolvedValue([]) },
    delivery: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "del_new" }),
    },
    deliveryAttempt: { create: vi.fn().mockResolvedValue({}) },
    fieldMapping: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const queues = { enqueueDelivery: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const selections = {
    create: vi.fn().mockResolvedValue({ token: VALID_TOKEN, expiresAt: "2026-10-10T12:30:00.000Z" }),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(true),
  };
  const service = new ManualSendService(
    prisma as unknown as Database,
    audit as unknown as AuditService,
    queues as unknown as QueuesService,
    selections as unknown as LeadSelectionStore,
  );
  return { service, prisma, queues, audit, selections };
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

const TWO_LEADS = [
  { id: "lead_1", canonicalData: { email: "a@b.co" }, score: null },
  { id: "lead_2", canonicalData: { email: "c@d.co" }, score: 10 },
];

const ACTIVE_DESTINATION = [{ id: "dst_1", name: "HubSpot Prod", type: "HUBSPOT", status: "ACTIVE" }];

function activeDestinations(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `dst_${i + 1}`,
    name: `CRM ${i + 1}`,
    type: "WEBHOOK",
    status: "ACTIVE",
  }));
}

function body(overrides: Partial<ManualSendBody> = {}): ManualSendBody {
  return { leadIds: ["lead_1", "lead_2"], destinationIds: ["dst_1"], ...overrides };
}

// ---------------------------------------------------------------------------
// Selection snapshots
// ---------------------------------------------------------------------------

describe("ManualSendService.createSelection", () => {
  it("resolves the filtered lead IDs server-side into an opaque token", async () => {
    const { service, prisma, selections } = harness();
    prisma.lead.findMany.mockResolvedValue([{ id: "l1" }, { id: "l2" }, { id: "l3" }]);

    const result = await service.createSelection(ACTOR, { status: "NEW" });

    expect(result.count).toBe(3);
    expect(result.token).toBe(VALID_TOKEN);
    expect(result.mode).toBe("filtered");
    expect(selections.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR.userId, mode: "filtered", ids: ["l1", "l2", "l3"] }),
    );
  });

  it("rejects a selection that matches no leads", async () => {
    const { service } = harness();
    const err = await expectFailure(service.createSelection(ACTOR, {}), "BAD_REQUEST");
    expect(err.message).toMatch(/No leads match/i);
  });

  it("refuses snapshots above LEAD_SELECTION_MAX", async () => {
    const { service, prisma } = harness();
    prisma.lead.findMany.mockResolvedValue([{ id: "l1" }, { id: "l2" }, { id: "l3" }, { id: "l4" }, { id: "l5" }]);
    const err = await expectFailure(service.createSelection(ACTOR, {}), "PAYLOAD_TOO_LARGE");
    expect(err.message).toMatch(/more than 4 leads/i);
  });

  it("validates the filter criteria server-side (inverted dates → 422, no query)", async () => {
    const { service, prisma } = harness();
    await expectFailure(
      service.createSelection(ACTOR, { dateFrom: "2026-10-05", dateTo: "2026-10-01" }),
      "VALIDATION_FAILED",
    );
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it("translates quick ranges into an instants receivedAt range", async () => {
    const { service, prisma, selections } = harness();
    prisma.lead.findMany.mockResolvedValue([{ id: "l1" }]);

    await service.createSelection(ACTOR, { quickRange: "today" });

    const where = prisma.lead.findMany.mock.calls[0][0].where;
    expect(where.receivedAt.gte).toBeInstanceOf(Date);
    expect(where.receivedAt.lte).toBeInstanceOf(Date);
    expect(where.receivedAt.lte.getTime()).toBeGreaterThan(where.receivedAt.gte.getTime());
    expect(selections.create).toHaveBeenCalled();
  });
});

describe("selection tokens at send time", () => {
  it("refuses an empty lead ID list (never 'send everything')", async () => {
    const { service } = harness();
    const err = await expectFailure(service.send(ACTOR, body({ leadIds: [] })), "BAD_REQUEST");
    expect(err.message).toMatch(/Select at least one lead/i);
  });

  it("refuses a malformed token with a clear message", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.send(ACTOR, body({ leadIds: undefined, selectionToken: "short" })),
      "BAD_REQUEST",
    );
    expect(err.message).toMatch(/Invalid selection token/i);
  });

  it("treats an expired/consumed token as a conflict, not a silent re-send", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.send(ACTOR, body({ leadIds: undefined, selectionToken: VALID_TOKEN })),
      "CONFLICT",
    );
    expect(err.message).toMatch(/expired or was already sent/i);
  });

  it("rejects a token that belongs to another session", async () => {
    const { service, selections } = harness();
    selections.get.mockResolvedValue({
      actorId: "someone_else",
      mode: "filtered",
      ids: ["lead_1"],
      filters: {},
      createdAt: new Date().toISOString(),
    });
    await expectFailure(
      service.send(ACTOR, body({ leadIds: undefined, selectionToken: VALID_TOKEN })),
      "FORBIDDEN",
    );
  });

  it("rejects explicit selections above LEAD_SELECTION_MAX", async () => {
    const { service } = harness();
    const ids = ["l1", "l2", "l3", "l4", "l5"];
    const err = await expectFailure(service.send(ACTOR, body({ leadIds: ids })), "PAYLOAD_TOO_LARGE");
    expect(err.message).toMatch(/configured maximum of 4/i);
  });

  it("consumes the token only after a completed run", async () => {
    const { service, prisma, selections } = harness();
    selections.get.mockResolvedValue({
      actorId: ACTOR.userId,
      mode: "filtered",
      ids: ["lead_1"],
      filters: { quickRange: "today" },
      createdAt: new Date().toISOString(),
    });
    prisma.lead.findMany.mockResolvedValue([TWO_LEADS[0]]);
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);

    const result = await service.send(ACTOR, body({ leadIds: undefined, selectionToken: VALID_TOKEN }));

    expect(selections.delete).toHaveBeenCalledWith(VALID_TOKEN);
    expect(result.filters).toEqual({ quickRange: "today" });
  });
});

// ---------------------------------------------------------------------------
// Destination eligibility + limits (validated before any write)
// ---------------------------------------------------------------------------

describe("destination validation", () => {
  it("rejects unknown destinations before writing anything", async () => {
    const { service, prisma } = harness();
    prisma.destination.findMany.mockResolvedValue([]);
    const err = await expectFailure(service.send(ACTOR, body()), "VALIDATION_FAILED");
    expect(err.message).toMatch(/Destinations not found/i);
    expect(prisma.delivery.create).not.toHaveBeenCalled();
  });

  it("rejects inactive destinations by name", async () => {
    const { service, prisma } = harness();
    prisma.destination.findMany.mockResolvedValue([
      { id: "dst_1", name: "Old CRM", type: "WEBHOOK", status: "DISABLED" },
    ]);
    const err = await expectFailure(service.send(ACTOR, body()), "VALIDATION_FAILED");
    expect(err.message).toMatch(/Old CRM/);
    expect(err.message).toMatch(/not active/i);
    expect(prisma.delivery.create).not.toHaveBeenCalled();
  });

  it("refuses a send above MANUAL_SEND_MAX_DELIVERIES combinations", async () => {
    const { service, prisma } = harness();
    prisma.lead.findMany.mockResolvedValue(TWO_LEADS);
    prisma.destination.findMany.mockResolvedValue(activeDestinations(4)); // 2 × 4 = 8 > 6
    const err = await expectFailure(
      service.send(ACTOR, body({ leadIds: ["lead_1", "lead_2"], destinationIds: ["dst_1", "dst_2", "dst_3", "dst_4"] })),
      "PAYLOAD_TOO_LARGE",
    );
    expect(err.message).toMatch(/configured maximum is 6/i);
    expect(prisma.delivery.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The send itself
// ---------------------------------------------------------------------------

describe("ManualSendService.send", () => {
  it("queues one delivery per lead×destination with the submission correlation", async () => {
    const { service, prisma, queues, audit } = harness();
    prisma.lead.findMany.mockResolvedValue(TWO_LEADS);
    prisma.destination.findMany.mockResolvedValue(activeDestinations(2));

    const result = await service.send(
      ACTOR,
      body({ leadIds: ["lead_1", "lead_2"], destinationIds: ["dst_1", "dst_2"] }),
    );

    expect(result.created).toBe(4);
    expect(result.combinations).toBe(4);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.enqueueFailures).toBe(0);

    expect(prisma.delivery.create).toHaveBeenCalledTimes(4);
    const created = prisma.delivery.create.mock.calls.map(([args]) => args.data);
    for (const row of created) {
      expect(row.status).toBe("QUEUED");
      expect(row.correlationId).toBe(result.submissionId);
      expect(row.enqueuedAt).toBeInstanceOf(Date);
      expect(row.maxAttempts).toBe(getEnv().DELIVERY_MAX_ATTEMPTS);
    }
    // Default pass-through payload when the destination has no active mapping.
    expect(created[0].mappedPayload).toMatchObject({ email: "a@b.co" });

    expect(queues.enqueueDelivery).toHaveBeenCalledTimes(4);
    const createdPairs = new Set(created.map((row) => `${row.leadId}:${row.destinationId}`));
    for (const [job] of queues.enqueueDelivery.mock.calls) {
      expect(job.correlationId).toBe(result.submissionId);
      expect(createdPairs.has(`${job.leadId}:${job.destinationId}`)).toBe(true);
    }

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delivery.manual_send",
        entityId: result.submissionId,
        metadata: expect.objectContaining({ created: 4, mode: "page" }),
      }),
    );
  });

  it("skips existing deliveries (any status) — never resends a success", async () => {
    const { service, prisma, queues } = harness();
    prisma.lead.findMany.mockResolvedValue(TWO_LEADS);
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);
    prisma.delivery.findMany.mockResolvedValue([
      { leadId: "lead_1", destinationId: "dst_1", status: "SUCCEEDED" },
    ]);

    const result = await service.send(ACTOR, body());

    expect(result.created).toBe(1);
    expect(result.skippedExisting).toBe(1);
    expect(result.skipped).toBe(1);
    expect(prisma.delivery.create).toHaveBeenCalledTimes(1);
    expect(queues.enqueueDelivery).toHaveBeenCalledTimes(1);
    expect(prisma.delivery.create.mock.calls[0][0].data.leadId).toBe("lead_2");
  });

  it("a repeated submission is a no-op (no duplicate rows, no duplicate jobs)", async () => {
    const { service, prisma, queues } = harness();
    prisma.lead.findMany.mockResolvedValue(TWO_LEADS);
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);
    prisma.delivery.findMany.mockResolvedValue([
      { leadId: "lead_1", destinationId: "dst_1", status: "SUCCEEDED" },
      { leadId: "lead_2", destinationId: "dst_1", status: "QUEUED" },
    ]);

    const result = await service.send(ACTOR, body());

    expect(result.created).toBe(0);
    expect(result.skippedExisting).toBe(2);
    expect(prisma.delivery.create).not.toHaveBeenCalled();
    expect(queues.enqueueDelivery).not.toHaveBeenCalled();
  });

  it("skips leads deleted since the selection was made", async () => {
    const { service, prisma } = harness();
    prisma.lead.findMany.mockResolvedValue([TWO_LEADS[0]]); // lead_2 gone
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);

    const result = await service.send(ACTOR, body());

    expect(result.created).toBe(1);
    expect(result.missingLeads).toBe(1);
    expect(result.skippedMissingLeads).toBe(1);
  });

  it("fails fast (no external call) when the mapping misses required fields", async () => {
    const { service, prisma, queues } = harness();
    prisma.lead.findMany.mockResolvedValue([TWO_LEADS[0]]);
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);
    prisma.fieldMapping.findMany.mockResolvedValue([
      {
        destinationId: "dst_1",
        name: "Strict map",
        status: "ACTIVE",
        activeVersionId: "v1",
        versions: [
          {
            id: "v1",
            fields: [
              { source: "email", target: "Email" },
              { source: "custom.missing", target: "Company", required: true },
            ],
          },
        ],
      },
    ]);

    const result = await service.send(ACTOR, body({ leadIds: ["lead_1"] }));

    expect(result.failed).toBe(1);
    expect(result.created).toBe(0);
    expect(prisma.delivery.create).toHaveBeenCalledTimes(1);
    expect(prisma.delivery.create.mock.calls[0][0].data.status).toBe("FAILED");
    expect(prisma.deliveryAttempt.create).toHaveBeenCalledTimes(1);
    expect(prisma.deliveryAttempt.create.mock.calls[0][0].data.status).toBe("REJECTED");
    expect(queues.enqueueDelivery).not.toHaveBeenCalled();
  });

  it("treats a concurrent duplicate (unique-pair violation) as skipped, not an error", async () => {
    const { service, prisma } = harness();
    prisma.lead.findMany.mockResolvedValue([TWO_LEADS[0]]);
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);
    prisma.delivery.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));

    const result = await service.send(ACTOR, body({ leadIds: ["lead_1"] }));

    expect(result.created).toBe(0);
    expect(result.skippedExisting).toBe(1);
  });

  it("reports enqueue failures instead of losing them (sweeper recovers)", async () => {
    const { service, prisma, queues } = harness();
    prisma.lead.findMany.mockResolvedValue([TWO_LEADS[0]]);
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);
    queues.enqueueDelivery.mockRejectedValue(new Error("redis down"));

    const result = await service.send(ACTOR, body({ leadIds: ["lead_1"] }));

    expect(result.created).toBe(1);
    expect(result.enqueueFailures).toBe(1);
    expect(result.submissionId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Preview (authoritative counts for the confirmation dialog)
// ---------------------------------------------------------------------------

describe("ManualSendService.preview", () => {
  it("counts eligible vs skipped pairs without writing anything", async () => {
    const { service, prisma } = harness();
    prisma.lead.count.mockResolvedValue(2);
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);
    prisma.delivery.findMany.mockResolvedValue([
      { leadId: "lead_1", destinationId: "dst_1", status: "SUCCEEDED" },
    ]);

    const preview = await service.preview(ACTOR, body());

    expect(preview.combinations).toBe(2);
    expect(preview.eligible).toBe(1);
    expect(preview.skippedExisting).toBe(1);
    expect(preview.skippedMissingLeads).toBe(0);
    expect(preview.limits).toEqual({ maxLeads: 4, maxCombinations: 6 });
    expect(prisma.delivery.create).not.toHaveBeenCalled();
    expect(prisma.lead.findMany).not.toHaveBeenCalled(); // preview only counts
  });

  it("reports leads that vanished since the selection", async () => {
    const { service, prisma } = harness();
    prisma.lead.count.mockResolvedValue(1);
    prisma.destination.findMany.mockResolvedValue(ACTIVE_DESTINATION);

    const preview = await service.preview(ACTOR, body());

    expect(preview.leadCount).toBe(2);
    expect(preview.missingLeads).toBe(1);
    expect(preview.eligible).toBe(1);
    expect(preview.skippedMissingLeads).toBe(1);
  });
});
