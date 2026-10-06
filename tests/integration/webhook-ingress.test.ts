import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";
import { AuditService } from "../../apps/api/src/infra/audit.module";
import { SourcesService } from "../../apps/api/src/modules/sources/sources.service";
import { WebhooksService } from "../../apps/api/src/modules/webhooks/webhooks.service";
import { LeadsService } from "../../apps/api/src/modules/leads/leads.service";
import { cleanupFixture, createFixture, unique, type Fixture } from "./helpers";

describe("public webhook ingress (real PostgreSQL)", () => {
  let db: Database;
  let fixture: Fixture;
  let sources: SourcesService;
  let webhooks: WebhooksService;
  let leadsService: LeadsService;
  const enqueued: Array<{ leadId: string }> = [];
  const actor = {
    userId: "integration-test",
    email: "webhook-ingress@example.com",
    role: "admin",
    permissions: [],
    actorType: "USER",
    correlationId: "webhook-ingress-test",
  } as never;

  beforeAll(async () => {
    db = getPrisma();
    fixture = await createFixture(db);
    sources = new SourcesService(new AuditService());
    leadsService = new LeadsService(
      new AuditService(),
      {
        enqueueLeadIntake: async () => undefined,
      } as unknown as ConstructorParameters<typeof LeadsService>[1],
    );
    webhooks = new WebhooksService(
      sources,
      {
        enqueueLeadIntake: async (job: { leadId: string }) => {
          enqueued.push(job);
        },
      } as unknown as ConstructorParameters<typeof WebhooksService>[1],
    );
  });

  afterAll(async () => {
    await cleanupFixture(fixture, db);
  });

  it("creates an account without creating or returning a signing secret", async () => {
    const account = await sources.createAccount(actor, fixture.sourceId, {
      name: unique("Public Account"),
      config: { provider: "generic", requiredFields: ["name", "phone"] },
    });
    expect(account.signingSecret).toBeUndefined();
    expect(account.webhookUrl).toContain(account.publicId);
    expect(
      await db.integrationCredential.count({ where: { sourceAccountId: account.id, type: "WEBHOOK_HMAC" } }),
    ).toBe(0);
    fixture.accountId = account.id;
  });

  it("normalizes aliases, preserves raw payload and queues an unsigned lead", async () => {
    const account = await db.leadSourceAccount.findUniqueOrThrow({ where: { id: fixture.accountId } });
    const payload = {
      externalLeadId: unique("direct-lead"),
      full_name: "Arun Kumar",
      email_address: "arun@example.com",
      mobile_number: "+919876543210",
      location: "Chennai",
      state: "Tamil Nadu",
      budget: 7500000,
      leadId: "LD-9999999",
      providerExtra: { campaignId: "meta-campaign" },
    };
    const rawBody = JSON.stringify(payload);
    const result = await webhooks.ingress(account.publicId, payload, {}, rawBody);

    expect(result).toMatchObject({ received: true, duplicate: false });
    expect(result.leadId).toBeTruthy();
    expect(enqueued.some((job) => job.leadId === result.leadId)).toBe(true);

    const lead = await db.lead.findUniqueOrThrow({ where: { id: result.leadId as string } });
    expect(lead.canonicalData).toMatchObject({
      name: { first: "Arun", last: "Kumar", full: "Arun Kumar" },
      email: "arun@example.com",
      phone: "+919876543210",
      location: { city: "Chennai", state: "Tamil Nadu" },
      budget: 7500000,
    });
    expect(lead.externalLeadId).toBe(payload.externalLeadId);
    expect(lead.leadId).toMatch(/^LD-[0-9]{7}$/);
    expect(lead.leadId).not.toBe(payload.leadId);
    expect(lead.id).not.toBe(lead.leadId);
    expect((lead.canonicalData as Record<string, unknown>).raw).toEqual(payload);

    const raw = await db.leadRawPayload.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(raw.payload).toEqual(payload);
    const event = await db.webhookEvent.findUniqueOrThrow({ where: { id: result.eventId } });
    expect(event.status).toBe("PROCESSED");
    expect(event.payload).toEqual(payload);
  });

  it("generates unique consecutive IDs under concurrent webhook intake", async () => {
    const account = await db.leadSourceAccount.findUniqueOrThrow({ where: { id: fixture.accountId } });
    const payloads = Array.from({ length: 12 }, (_, index) => ({
      externalLeadId: unique(`parallel-${index}`),
      name: `Parallel Lead ${index}`,
      phone: `+9198765${String(index).padStart(5, "0")}`,
    }));
    const results = await Promise.all(
      payloads.map((payload) =>
        webhooks.ingress(account.publicId, payload, {}, JSON.stringify(payload)),
      ),
    );
    const rows = await db.lead.findMany({
      where: { id: { in: results.map((result) => result.leadId as string) } },
      select: { id: true, leadId: true },
    });
    const numbers = rows.map((row) => Number(row.leadId.slice(3))).sort((a, b) => a - b);

    expect(rows).toHaveLength(payloads.length);
    expect(new Set(rows.map((row) => row.leadId)).size).toBe(payloads.length);
    expect(rows.every((row) => /^LD-[0-9]{7}$/.test(row.leadId))).toBe(true);
    expect(rows.every((row) => row.id !== row.leadId)).toBe(true);
    expect(numbers.every((number, index) => index === 0 || number === (numbers[index - 1] ?? 0) + 1)).toBe(true);
  });

  it("searches leads by business and internal ID", async () => {
    const account = await db.leadSourceAccount.findUniqueOrThrow({ where: { id: fixture.accountId } });
    const payload = {
      externalLeadId: unique("search-lead"),
      name: "Search Lead",
      phone: "+919111111111",
    };
    const result = await webhooks.ingress(account.publicId, payload, {}, JSON.stringify(payload));
    if (!result.leadId) throw new Error("expected an internal lead ID");
    const lead = await db.lead.findUniqueOrThrow({ where: { id: result.leadId } });

    const businessIdResults = await leadsService.list(actor, { q: lead.leadId });
    const internalIdResults = await leadsService.list(actor, { q: lead.id });
    const nameResults = await leadsService.list(actor, { q: "Search Lead" });
    expect(businessIdResults.items).toContainEqual(expect.objectContaining({ id: lead.id, leadId: lead.leadId }));
    expect(internalIdResults.items).toContainEqual(expect.objectContaining({ id: lead.id, leadId: lead.leadId }));
    expect(nameResults.items).toContainEqual(expect.objectContaining({ id: lead.id, leadId: lead.leadId }));
  });

  it("assigns a server-owned business ID to manually created leads", async () => {
    const result = await leadsService.create(actor, {
      sourceId: fixture.sourceId,
      sourceAccountId: fixture.accountId,
      data: {
        name: { full: "Manual Lead" },
        email: "manual-lead@example.com",
        phone: "+919876500000",
        leadId: "LD-9999999",
      },
    });

    expect(result.id).toBeTruthy();
    expect(result.leadId).toMatch(/^LD-[0-9]{7}$/);
    expect(result.leadId).not.toBe("LD-9999999");
  });

  it("returns the existing idempotent response for a repeated external lead", async () => {
    const account = await db.leadSourceAccount.findUniqueOrThrow({ where: { id: fixture.accountId } });
    const payload = {
      externalLeadId: unique("replay-lead"),
      name: "Replay Lead",
      phone: "+919999999999",
    };
    const raw = JSON.stringify(payload);
    const first = await webhooks.ingress(account.publicId, payload, {}, raw);
    const queuedBeforeReplay = enqueued.length;
    const replay = await webhooks.ingress(account.publicId, payload, {}, raw);

    expect(replay).toMatchObject({
      received: true,
      duplicate: true,
      eventId: first.eventId,
      leadId: first.leadId,
    });
    expect(enqueued).toHaveLength(queuedBeforeReplay);
    expect(await db.lead.count({ where: { externalLeadId: payload.externalLeadId } })).toBe(1);
  });

  it("rejects missing required fields before creating or queueing anything", async () => {
    const account = await db.leadSourceAccount.findUniqueOrThrow({ where: { id: fixture.accountId } });
    const payload = { externalLeadId: unique("missing-phone"), name: "No Phone" };
    const eventsBefore = await db.webhookEvent.count({ where: { sourceAccountId: account.id } });
    const leadsBefore = await db.lead.count({ where: { sourceAccountId: account.id } });
    const queuedBefore = enqueued.length;

    await expect(
      webhooks.ingress(account.publicId, payload, {}, JSON.stringify(payload)),
    ).rejects.toMatchObject({
      code: "LEAD_VALIDATION_FAILED",
      httpStatus: 400,
      message: "Required field 'phone' is missing.",
    });
    expect(await db.webhookEvent.count({ where: { sourceAccountId: account.id } })).toBe(eventsBefore);
    expect(await db.lead.count({ where: { sourceAccountId: account.id } })).toBe(leadsBefore);
    expect(enqueued).toHaveLength(queuedBefore);
  });

  it("returns a safe not-found error for an invalid public id", async () => {
    await expect(
      webhooks.ingress("invalid-public-id", {}, {}, "{}"),
    ).rejects.toMatchObject({ code: "SOURCE_ACCOUNT_NOT_FOUND", httpStatus: 404 });
  });
});
