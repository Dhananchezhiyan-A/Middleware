import { describe, expect, it } from "vitest";
import { buildWebhookBody, webhookResponseResult } from "./webhook";

const parts = {
  mappedPayload: { FirstName: "Test", MobilePhone: "7708181809" },
  idempotencyKey: "ld-1|dst-1",
  attempt: 1,
  correlationId: "corr-1",
  leadId: "lead-1",
  now: "2026-10-07T10:40:58.740Z",
};

describe("buildWebhookBody", () => {
  it("defaults to the delivery envelope", () => {
    const parsed = JSON.parse(buildWebhookBody(parts, { url: "https://example.test" })) as Record<
      string,
      unknown
    >;
    expect(parsed.idempotencyKey).toBe("ld-1|dst-1");
    expect(parsed.attempt).toBe(1);
    expect(parsed.correlationId).toBe("corr-1");
    expect(parsed.leadId).toBe("lead-1");
    expect(parsed.timestamp).toBe("2026-10-07T10:40:58.740Z");
    expect(parsed.payload).toEqual(parts.mappedPayload);
    expect(parsed.FirstName).toBeUndefined();
  });

  it("keeps an explicit envelope mode as the envelope", () => {
    const parsed = JSON.parse(
      buildWebhookBody(parts, { url: "https://example.test", bodyMode: "envelope" }),
    ) as Record<string, unknown>;
    expect(parsed.payload).toEqual(parts.mappedPayload);
  });

  it("sends only the mapped fields top-level in flat mode", () => {
    const body = buildWebhookBody(parts, { url: "https://example.test", bodyMode: "flat" });
    expect(JSON.parse(body)).toEqual(parts.mappedPayload);
    expect(body).toBe(JSON.stringify(parts.mappedPayload));
    expect(JSON.parse(body)).toMatchObject({ MobilePhone: "7708181809" });
    expect(body).not.toContain("idempotencyKey");
  });

  it("treats an unknown bodyMode as the envelope (safe default)", () => {
    const parsed = JSON.parse(
      buildWebhookBody(parts, { url: "https://example.test", bodyMode: "raw" }),
    ) as Record<string, unknown>;
    expect(parsed.payload).toEqual(parts.mappedPayload);
  });
});

describe("webhookResponseResult", () => {
  const response = (bodyText: string, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    bodyText,
    headers: new Headers(),
    durationMs: 1,
  });

  it("records an HTTP-200 CRM business failure as a non-retryable failure and preserves Msg", () => {
    const result = webhookResponseResult(
      response('{"Status":"Failed","Msg":"ERROR (DML):Mobile No. is Mandatory ! , "}'),
      "https://example.test/leads",
    );
    expect(result).toMatchObject({
      success: false,
      responseStatus: 200,
      errorMessage: "ERROR (DML):Mobile No. is Mandatory ! , ",
      retryable: false,
    });
  });

  it("continues to accept genuine HTTP success responses", () => {
    const result = webhookResponseResult(
      response('{"Status":"Success","Msg":"Lead created"}'),
      "https://example.test/leads",
    );
    expect(result).toMatchObject({
      success: true,
      responseStatus: 200,
      responseBody: '{"Status":"Success","Msg":"Lead created"}',
      retryable: false,
    });
  });

  it("continues to classify non-2xx responses by HTTP status", () => {
    const result = webhookResponseResult(
      response('{"Status":"Failed","Msg":"Rejected"}', 400),
      "https://example.test/leads",
    );
    expect(result).toMatchObject({ success: false, responseStatus: 400, retryable: false });
  });
});
