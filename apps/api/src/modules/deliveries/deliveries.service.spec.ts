import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@middleware/shared";
import { DeliveriesService } from "./deliveries.service";

/**
 * Delivery listing filter + the manual-send progress stats. Prisma is mocked
 * here (the DB-backed behaviour is covered by the integration suite).
 */

const mocks = vi.hoisted(() => ({
  deliveryFindMany: vi.fn().mockResolvedValue([]),
  deliveryCount: vi.fn().mockResolvedValue(0),
  deliveryGroupBy: vi.fn().mockResolvedValue([]),
  destinationFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock("@middleware/database", () => ({
  getPrisma: () => ({
    delivery: {
      findMany: mocks.deliveryFindMany,
      count: mocks.deliveryCount,
      groupBy: mocks.deliveryGroupBy,
    },
    destination: { findMany: mocks.destinationFindMany },
  }),
}));

function service(): DeliveriesService {
  return new DeliveriesService({} as never, {} as never);
}

beforeEach(() => {
  mocks.deliveryFindMany.mockClear().mockResolvedValue([]);
  mocks.deliveryCount.mockClear().mockResolvedValue(0);
  mocks.deliveryGroupBy.mockClear().mockResolvedValue([]);
  mocks.destinationFindMany.mockClear().mockResolvedValue([]);
});

describe("DeliveriesService.list — correlationId filter", () => {
  it("scopes the query to one submission", async () => {
    await service().list({ correlationId: "corr_42", limit: 10 });
    expect(mocks.deliveryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ correlationId: "corr_42" }) }),
    );
  });

  it("combines correlationId with the status filter", async () => {
    await service().list({ correlationId: "corr_42", status: "QUEUED" });
    const where = mocks.deliveryFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ correlationId: "corr_42", status: "QUEUED" });
  });
});

describe("DeliveriesService.stats", () => {
  it("aggregates per-status counts across the submission's deliveries", async () => {
    mocks.deliveryGroupBy.mockResolvedValue([
      { destinationId: "dst_1", status: "QUEUED", _count: { _all: 2 } },
      { destinationId: "dst_1", status: "SUCCEEDED", _count: { _all: 1 } },
      { destinationId: "dst_2", status: "FAILED", _count: { _all: 1 } },
    ]);
    mocks.destinationFindMany.mockResolvedValue([
      { id: "dst_1", name: "HubSpot Prod", type: "HUBSPOT" },
      { id: "dst_2", name: "Zoho", type: "ZOHO" },
    ]);

    const stats = await service().stats("corr_42");

    expect(stats.total).toBe(4);
    expect(stats.byStatus).toMatchObject({
      QUEUED: 2,
      SUCCEEDED: 1,
      FAILED: 1,
      IN_PROGRESS: 0,
      PENDING: 0,
      DEAD: 0,
      SKIPPED: 0,
    });
    expect(stats.destinations).toHaveLength(2);
    const hubspot = stats.destinations.find((d) => d.id === "dst_1");
    expect(hubspot?.byStatus.QUEUED).toBe(2);
    expect(mocks.deliveryGroupBy.mock.calls[0][0].where).toMatchObject({ correlationId: "corr_42" });
  });

  it("returns zeroed counts for a submission with no deliveries", async () => {
    const stats = await service().stats("corr_empty");
    expect(stats.total).toBe(0);
    expect(stats.byStatus.QUEUED).toBe(0);
    expect(stats.destinations).toEqual([]);
    expect(mocks.destinationFindMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid correlation id without touching the database", async () => {
    try {
      await service().stats("not a valid id!");
      throw new Error("expected stats() to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VALIDATION_FAILED");
    }
    expect(mocks.deliveryGroupBy).not.toHaveBeenCalled();
  });
});
