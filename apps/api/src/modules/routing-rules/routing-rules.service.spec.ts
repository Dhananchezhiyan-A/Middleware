import { describe, expect, it } from "vitest";
import type { Database } from "@middleware/database";
import { RoutingRulesService, type RoutingPreviewInput } from "./routing-rules.service";

/**
 * Routing PREVIEW must distinguish "rule matched" from "valid external
 * destination available", and report the INTERNAL_MIDDLEWARE fallback — the
 * fallback is this application itself, so it never produces a delivery.
 *
 * Only `preview()` is exercised (pure read + the shared engine); the prisma
 * surface it touches is stubbed so no database is required.
 */

const DISABLED_DESTINATION = {
  id: "d_disabled",
  name: "Salesforce",
  type: "SALESFORCE",
  status: "DISABLED",
};

const ACTIVE_DESTINATION = {
  id: "d_active",
  name: "DCT CRM",
  type: "DCT_CRM",
  status: "ACTIVE",
};

interface StoredRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  stopOnMatch: boolean;
  conditions: unknown;
  destinations: Array<{ order: number; destination: typeof ACTIVE_DESTINATION }>;
}

function service(options: {
  storedRules?: StoredRule[];
  destinations?: Array<typeof ACTIVE_DESTINATION>;
}): RoutingRulesService {
  const prisma = {
    routingRule: { findMany: async () => options.storedRules ?? [] },
    // Draft destination ids are resolved against this list: unknown ids are
    // dropped, exactly like a destination that does not exist at all.
    destination: { findMany: async () => options.destinations ?? [] },
    leadSource: { findUnique: async () => null },
    leadSourceAccount: { findUnique: async () => null },
  } as unknown as Database;

  return new RoutingRulesService(prisma, {} as never);
}

const MATCH_ALL = { match: "ALL", conditions: [] } as const;

function draft(destinationIds: string[], email = "lead@example.com") {
  return {
    name: "Draft rule",
    priority: 1,
    enabled: true,
    stopOnMatch: false,
    conditions: {
      match: "ALL",
      conditions: [{ field: "canonical.email", operator: "CONTAINS", value: email }],
    },
    destinationIds,
  };
}

function input(rules: RoutingPreviewInput["rules"]): RoutingPreviewInput {
  return {
    receivedAt: new Date("2024-06-15T10:00:00.000Z").toISOString(),
    canonical: { email: "lead@example.com" },
    rules,
  };
}

describe("RoutingRulesService.preview — internal fallback", () => {
  it("no rule matched → INTERNAL_MIDDLEWARE and zero external deliveries", async () => {
    const preview = await service({ destinations: [ACTIVE_DESTINATION] }).preview(
      {} as never,
      // The rule never matches this sample lead.
      input([{ ...draft(["d_active"], "no-match@example.com") }]),
    );

    expect(preview.matched).toBe(false);
    expect(preview.destinations).toEqual([]);
    expect(preview.validDestinationCount).toBe(0);
    expect(preview.deliveryCount).toBe(0);
    expect(preview.usedFallback).toBe(true);
    expect(preview.fallback?.type).toBe("INTERNAL_MIDDLEWARE");
    expect(preview.reason).toMatch(/no rule matched/i);
  });

  it("rule matched but destination disabled → INTERNAL_MIDDLEWARE, still 0 deliveries", async () => {
    const preview = await service({ destinations: [DISABLED_DESTINATION] }).preview(
      {} as never,
      input([draft(["d_disabled"])]),
    );

    // "matched" is honest about the rule — and deliberately separate from
    // "deliverable".
    expect(preview.matched).toBe(true);
    expect(preview.rules[0]?.matched).toBe(true);
    expect(preview.validDestinationCount).toBe(0);
    expect(preview.deliveryCount).toBe(0);
    expect(preview.destinations).toEqual([]);
    expect(preview.fallback?.type).toBe("INTERNAL_MIDDLEWARE");
    expect(preview.fallback?.reason).toMatch(/no valid external destination/i);
  });

  it("valid external destination → no fallback and one external delivery", async () => {
    const preview = await service({ destinations: [ACTIVE_DESTINATION] }).preview(
      {} as never,
      input([draft(["d_active"])]),
    );

    expect(preview.matched).toBe(true);
    expect(preview.destinations).toEqual([
      { id: "d_active", name: "DCT CRM", type: "DCT_CRM" },
    ]);
    expect(preview.validDestinationCount).toBe(1);
    expect(preview.deliveryCount).toBe(1);
    expect(preview.fallback).toBeNull();
    expect(preview.usedFallback).toBe(false);
  });

  it("two valid destinations → one delivery each (deduped)", async () => {
    const preview = await service({
      destinations: [ACTIVE_DESTINATION, { ...DISABLED_DESTINATION, status: "ACTIVE" }],
    }).preview({} as never, input([draft(["d_active", "d_disabled"])]));

    expect(preview.validDestinationCount).toBe(2);
    expect(preview.deliveryCount).toBe(2);
    expect(preview.fallback).toBeNull();
  });

  it("stored rules use the same decision as draft rules", async () => {
    const preview = await service({
      destinations: [DISABLED_DESTINATION],
      storedRules: [
        {
          id: "r_stored",
          name: "Stored rule",
          priority: 1,
          enabled: true,
          stopOnMatch: true,
          conditions: MATCH_ALL,
          destinations: [{ order: 0, destination: DISABLED_DESTINATION }],
        },
      ],
    }).preview({} as never, {
      receivedAt: new Date("2024-06-15T10:00:00.000Z").toISOString(),
      canonical: { email: "lead@example.com" },
    });

    expect(preview.matched).toBe(true);
    expect(preview.deliveryCount).toBe(0);
    expect(preview.fallback?.type).toBe("INTERNAL_MIDDLEWARE");
  });

  it("never resolves a destination named 'middleware' for the fallback", async () => {
    const preview = await service({ destinations: [ACTIVE_DESTINATION] }).preview(
      {} as never,
      input([{ ...draft(["d_active"], "no-match@example.com") }]),
    );

    expect(preview.destinations).toEqual([]);
    expect(preview.deliveryCount).toBe(0);
    expect(preview.fallback?.type).toBe("INTERNAL_MIDDLEWARE");
  });
});
