import { Injectable, Logger } from "@nestjs/common";
import { getPrisma } from "@middleware/database";
import { AppError, errors, sanitizeDeep, sanitizeHeaders } from "@middleware/shared";
import type { RequestActor } from "@middleware/types";
import { QueuesService } from "../../infra/redis.module";
import { SourcesService, webhookIdempotencyKey } from "../sources/sources.service";

export interface IngressResult {
  received: boolean;
  duplicate: boolean;
  eventId: string;
  leadId: string | null;
}

/**
 * Inbound webhook ingress.
 *
 * Contract with providers:
 *  - FAST ACK: the event is fully persisted (WebhookEvent + Lead + raw
 *    payload) BEFORE we respond 201; heavy work happens on BullMQ queues.
 *  - IDEMPOTENT: the (account, idempotencyKey) unique constraint
 *    makes replays impossible to double-process — replays return 202 with
 *    `duplicate: true`.
 *  - PUBLIC URL: the unguessable account URL identifies the source. No
 *    end-user signing or middleware session is required for ordinary intake.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly sources: SourcesService,
    private readonly queues: QueuesService,
  ) {}

  async ingress(
    publicId: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    ip?: string,
  ): Promise<IngressResult> {
    const account = await this.sources.getAccountByPublicId(publicId);
    const { sourceId, id: sourceAccountId } = account;
    const config = (account.config ?? {}) as Record<string, unknown>;

    // --- 2. Idempotency key + event persistence --------------------------------
    const externalEventId = this.externalEventId(headers, body);
    const idempotencyKey = webhookIdempotencyKey(sourceAccountId, externalEventId, rawBody);
    const prisma = getPrisma();
    const payload = this.toPayload(body);
    const normalized = this.normalizePayload(payload, account.source.type, config);
    const canonical = normalized.canonical;
    this.validateRequiredFields(canonical, config);

    let event;
    let duplicate = false;
    try {
      event = await prisma.webhookEvent.create({
        data: {
          sourceAccountId,
          sourceId,
          externalEventId,
          idempotencyKey,
          status: "RECEIVED",
          headers: sanitizeHeaders(headers as never) as never,
          payload: payload as never,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      duplicate = true;
      const existing = await prisma.webhookEvent.findUnique({
        where: {
          sourceAccountId_idempotencyKey: {
            sourceAccountId,
            idempotencyKey,
          },
        },
      });
      if (!existing) throw err;
      event = existing;
      // Fully processed before → nothing to do, just acknowledge the replay.
      if (existing.status === "PROCESSED" && existing.leadId) {
        return { received: true, duplicate: true, eventId: existing.id, leadId: existing.leadId };
      }
      // RECEIVED/FAILED/DUPLICATE → resume processing (crash/queue recovery).
      await prisma.webhookEvent.update({
        where: { id: existing.id },
        data: { status: "RECEIVED", error: null },
      });
    }

    // --- 3. Create (or reattach to) the lead ------------------------------------
    let leadId: string | null = null;
    const providerLeadId = this.providerLeadId(headers, body);
    try {
      const lead = await prisma.lead.create({
        data: {
          sourceId: sourceId ?? account.sourceId,
          sourceAccountId,
          externalLeadId: providerLeadId,
          status: "RECEIVED",
          stage: "RECEIVED",
          canonicalData: canonical as never,
          normalizedData: normalized.providerData as never,
          // Birth correlation: every other creation path (CSV import, manual
          // API create) stamps Lead.correlationId — ingress must too, or the
          // primary entity loses its traceability link to the source event.
          correlationId: `wh:${event.id}`,
        },
      });
      leadId = lead.id;
      await prisma.leadRawPayload.create({
        data: {
          leadId: lead.id,
          sourceAccountId,
          payload: payload as never,
          headers: sanitizeHeaders(headers as never) as never,
          contentType: "application/json",
          checksum: webhookIdempotencyKey(sourceAccountId, externalEventId, rawBody),
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      // Provider re-sent a lead id we already have → attach to the existing lead.
      const existing = await prisma.lead.findFirst({
        where: { sourceAccountId, externalLeadId: providerLeadId },
        select: { id: true },
      });
      if (!existing) throw err;
      leadId = existing.id;
    }

    // --- 4. Enqueue processing; only then mark the event processed ---------------
    try {
      await this.queues.enqueueLeadIntake({
        leadId: leadId as string,
        correlationId: `wh:${event.id}`,
        webhookEventId: event.id,
      });
    } catch (err) {
      // Queue down: the event + lead are SAFE in PostgreSQL. Mark FAILED so
      // the provider's retry (or our resume path above) re-enqueues them.
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          leadId,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
        },
      });
      this.logger.error(`Ingress persisted but enqueue failed for event ${event.id}: ${String(err)}`);
      throw errors.queueUnavailable("Lead received but queueing failed; please retry.", err);
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: duplicate ? "DUPLICATE" : "PROCESSED", leadId, processedAt: new Date() },
    });

    void ip; // available for abuse analysis; WebhookEvent keeps the audit trail
    return { received: true, duplicate, eventId: event.id, leadId };
  }

  // --- Event log (observability) ------------------------------------------------

  async listEvents(
    _actor: RequestActor,
    query: { status?: string; sourceAccountId?: string; cursor?: string | null; limit?: number },
  ) {
    const where: Record<string, unknown> = {};
    if (query.status) where["status"] = query.status;
    if (query.sourceAccountId) where["sourceAccountId"] = query.sourceAccountId;
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);

    const rows = await getPrisma().webhookEvent.findMany({
      where: where as never,
      orderBy: { receivedAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        sourceAccountId: true,
        externalEventId: true,
        status: true,
        leadId: true,
        error: true,
        receivedAt: true,
        processedAt: true,
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const lastReceivedAt = hasMore ? items.at(-1)?.receivedAt : undefined;
    return {
      items,
      nextCursor: lastReceivedAt
        ? Buffer.from(JSON.stringify({ receivedAt: lastReceivedAt.toISOString() })).toString(
            "base64url",
          )
        : null,
    };
  }

  async getEvent(_actor: RequestActor, id: string) {
    const event = await getPrisma().webhookEvent.findFirst({ where: { id } });
    if (!event) throw errors.notFound("Webhook event not found.");
    return { ...event, payload: sanitizeDeep(event.payload) };
  }

  // --- helpers ------------------------------------------------------------------

  private externalEventId(headers: Record<string, string | string[] | undefined>, body: unknown): string | null {
    for (const name of ["x-event-id", "x-webhook-event-id", "webhook-id"]) {
      const raw = headers[name];
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (value) return value.slice(0, 200);
    }
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const obj = body as Record<string, unknown>;
      for (const key of [
        "event_id",
        "eventId",
        "notification_id",
        "externalLeadId",
        "external_lead_id",
        "lead_id",
        "leadgen_id",
      ]) {
        const v = obj[key];
        if (typeof v === "string" && v) return v.slice(0, 200);
      }
    }
    return null;
  }

  private providerLeadId(headers: Record<string, string | string[] | undefined>, body: unknown): string | null {
    const header = headers["x-lead-id"];
    const headerValue = Array.isArray(header) ? header[0] : header;
    if (headerValue) return headerValue.slice(0, 200);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const obj = body as Record<string, unknown>;
      for (const key of [
        "lead_id",
        "leadgen_id",
        "externalLeadId",
        "external_lead_id",
        "id",
      ]) {
        const v = obj[key];
        if (typeof v === "string" && v) return v.slice(0, 200);
      }
    }
    return null;
  }

  private toPayload(body: unknown): Record<string, unknown> {
    if (Array.isArray(body)) return { events: body };
    if (body && typeof body === "object") return body as Record<string, unknown>;
    return { raw: body };
  }

  private normalizePayload(
    payload: Record<string, unknown>,
    sourceType: string,
    config: Record<string, unknown>,
  ): { canonical: Record<string, unknown>; providerData: Record<string, unknown> } {
    const flattened = this.flattenProviderPayload(payload);
    const values = new Map<string, unknown>();
    for (const [key, value] of Object.entries(flattened)) {
      values.set(this.normalizeKey(key), value);
    }

    const valueFor = (...aliases: string[]): unknown => {
      for (const alias of aliases) {
        const value = values.get(this.normalizeKey(alias));
        if (value !== undefined && value !== null && value !== "") return value;
      }
      return undefined;
    };
    const custom: Record<string, unknown> = { ...flattened };
    const canonical: Record<string, unknown> = {
      raw: payload,
      custom,
    };
    const firstName = valueFor("first_name", "firstName", "given_name", "givenName");
    const lastName = valueFor("last_name", "lastName", "family_name", "familyName", "surname");
    const fullName = valueFor("name", "full_name", "fullName", "contact_name", "contactName");
    if (firstName !== undefined || lastName !== undefined || fullName !== undefined) {
      const parts = typeof fullName === "string" ? fullName.trim().split(/\s+/) : [];
      canonical["name"] = {
        ...(typeof firstName === "string" || parts.length > 0
          ? { first: typeof firstName === "string" ? firstName : parts[0] }
          : {}),
        ...(typeof lastName === "string" || parts.length > 1
          ? { last: typeof lastName === "string" ? lastName : parts.slice(1).join(" ") }
          : {}),
        ...(typeof fullName === "string" ? { full: fullName } : {}),
      };
    }
    this.assignIfPresent(canonical, "email", valueFor("email", "email_address", "emailAddress", "work_email"));
    this.assignIfPresent(canonical, "emailAlt", valueFor("email_alt", "alternate_email", "secondary_email"));
    this.assignIfPresent(canonical, "phone", valueFor("phone", "phone_number", "phoneNumber", "mobile", "mobile_number", "mobileNumber", "telephone"));
    this.assignIfPresent(canonical, "phoneAlt", valueFor("phone_alt", "alternate_phone", "secondary_phone"));
    this.assignIfPresent(canonical, "company", valueFor("company", "company_name", "companyName", "organization"));
    this.assignIfPresent(canonical, "jobTitle", valueFor("job_title", "jobTitle", "title", "occupation"));
    this.assignIfPresent(canonical, "project", valueFor("project", "project_name", "projectName", "development"));
    const budget = valueFor("budget", "budget_range", "budgetRange", "monthly_budget");
    if (typeof budget === "number" || (typeof budget === "string" && budget.trim() !== "")) {
      const parsedBudget = typeof budget === "number" ? budget : Number(budget.replace(/[,\s]/g, ""));
      if (Number.isFinite(parsedBudget)) canonical["budget"] = parsedBudget;
    }
    this.assignIfPresent(canonical, "currency", valueFor("currency", "currency_code", "currencyCode"));

    const location: Record<string, unknown> = {};
    this.assignIfPresent(location, "city", valueFor("city", "location", "locality", "town"));
    this.assignIfPresent(location, "state", valueFor("state", "region", "province"));
    this.assignIfPresent(location, "country", valueFor("country", "country_code", "countryCode"));
    this.assignIfPresent(location, "postalCode", valueFor("postal_code", "postalCode", "zip", "zip_code", "zipcode"));
    if (Object.keys(location).length > 0) canonical["location"] = location;

    const fieldMapping = config["fieldMapping"];
    if (fieldMapping && typeof fieldMapping === "object" && !Array.isArray(fieldMapping)) {
      for (const [target, source] of Object.entries(fieldMapping)) {
        if (typeof source !== "string") continue;
        const value = values.get(this.normalizeKey(source));
        if (value !== undefined && value !== null && value !== "") {
          this.setCanonicalPath(canonical, target, value);
          delete custom[source];
        }
      }
    }

    const provider = this.providerName(config["provider"], sourceType, payload);
    return {
      canonical,
      providerData: { provider, fields: flattened },
    };
  }

  private flattenProviderPayload(value: Record<string, unknown>): Record<string, unknown> {
    const flattened: Record<string, unknown> = {};
    const visit = (input: unknown): void => {
      if (Array.isArray(input)) {
        for (const item of input) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const itemObject = item as Record<string, unknown>;
            const key =
              itemObject["name"] ??
              itemObject["key"] ??
              itemObject["field_name"] ??
              itemObject["column_id"];
            const itemValue =
              itemObject["values"] ??
              itemObject["value"] ??
              itemObject["field_value"] ??
              itemObject["string_value"];
            if (typeof key === "string" && itemValue !== undefined) {
              flattened[key] = Array.isArray(itemValue) ? itemValue[0] : itemValue;
            } else {
              visit(itemObject);
            }
          }
        }
        return;
      }
      if (!input || typeof input !== "object") return;
      for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
        if (["field_data", "user_column_data", "fields", "answers"].includes(this.normalizeKey(key)) && Array.isArray(child)) {
          visit(child);
        } else if (child && typeof child === "object" && !Array.isArray(child)) {
          const nested = child as Record<string, unknown>;
          if ("value" in nested && Object.keys(nested).length <= 3) {
            flattened[key] = nested["value"];
          } else {
            visit(nested);
          }
        } else if (!Array.isArray(child)) {
          flattened[key] = child;
        } else {
          visit(child);
        }
      }
    };
    visit(value);
    return flattened;
  }

  private normalizeKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  private assignIfPresent(target: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined && value !== null && value !== "") target[key] = value;
  }

  private setCanonicalPath(canonical: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".").filter(Boolean);
    if (parts.length === 0) return;
    let current = canonical;
    for (const part of parts.slice(0, -1)) {
      const child = current[part];
      if (!child || typeof child !== "object" || Array.isArray(child)) current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
    current[parts.at(-1) as string] = value;
  }

  private providerName(configured: unknown, sourceType: string, payload: Record<string, unknown>): string {
    const hasKey = (value: unknown, keys: Set<string>): boolean => {
      if (Array.isArray(value)) return value.some((item) => hasKey(item, keys));
      if (!value || typeof value !== "object") return false;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keys.has(this.normalizeKey(key)) || hasKey(child, keys)) return true;
      }
      return false;
    };
    if (typeof configured === "string" && configured.trim() && configured.toLowerCase() !== "generic") {
      return configured.trim().toLowerCase();
    }
    if (hasKey(payload, new Set(["usercolumndata"]))) return "google";
    if (hasKey(payload, new Set(["fielddata", "leadgenid"]))) return "meta";
    if (hasKey(payload, new Set(["leadinfo"]))) return "linkedin";
    if (sourceType === "META_ADS") return "meta";
    if (sourceType === "LINKEDIN") return "linkedin";
    if (sourceType === "GOOGLE_ADS") return "google";
    return "generic";
  }

  private validateRequiredFields(canonical: Record<string, unknown>, config: Record<string, unknown>): void {
    const required = config["requiredFields"];
    if (!Array.isArray(required)) return;
    for (const field of required) {
      if (typeof field !== "string" || field.trim() === "") continue;
      const value = field.split(".").reduce<unknown>((current, part) => {
        if (!current || typeof current !== "object") return undefined;
        return (current as Record<string, unknown>)[part];
      }, canonical);
      if (value === undefined || value === null || value === "") {
        throw new AppError("LEAD_VALIDATION_FAILED", `Required field '${field}' is missing.`, {
          httpStatus: 400,
        });
      }
    }
  }
}
