import { describe, expect, it } from "vitest";
import type { CanonicalLead } from "@middleware/types";
import { validateCanonical } from "@middleware/validation";
import { dedupHash, normalizeCanonical, normalizePhone } from "./validate-normalize";

const VALID_EMAIL = "  Priya@Example.COM ";

const valid: CanonicalLead = {
  name: { full: "Priya Raman" },
  email: VALID_EMAIL,
  phone: "+91 98765-43210",
  budget: 5_000_000,
};

describe("validateCanonical", () => {
  it("accepts a lead with email and phone", () => {
    const result = validateCanonical(valid);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("requires at least one contact channel", () => {
    const result = validateCanonical({ company: "No contact" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/contact channel/i);
  });

  it("rejects malformed email", () => {
    const result = validateCanonical({ email: "not-an-email" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /email/i.test(e))).toBe(true);
  });

  it("rejects malformed phone", () => {
    const result = validateCanonical({ phone: "12345" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /phone/i.test(e))).toBe(true);
  });

  it("rejects negative budget", () => {
    const result = validateCanonical({ email: "a@b.co", budget: -1 });
    expect(result.ok).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("strips separators and keeps a single leading +", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("(022) 4000-1234")).toBe("02240001234");
    expect(normalizePhone("  ")).toBeUndefined();
    expect(normalizePhone(undefined)).toBeUndefined();
  });
});

describe("normalizeCanonical", () => {
  it("lowercases email, normalizes phone, splits full name, uppercases currency", () => {
    const out = normalizeValid();
    expect(out.canonical.email).toBe("priya@example.com");
    expect(out.canonical.phone).toBe("+919876543210");
    expect(out.canonical.name).toEqual({ full: "Priya Raman", first: "Priya", last: "Raman" });
    expect(out.canonical.currency).toBe("USD");
  });

  it("produces stable application-keyed dedup hashes", () => {
    const out = normalizeValid();
    expect(out.dedupEmailHash).toBe(dedupHash("priya@example.com"));
    expect(out.dedupPhoneHash).toBe(dedupHash("+919876543210"));
    expect(dedupHash("priya@example.com")).toBe(out.dedupEmailHash);
  });

  it("does not mutate the input object", () => {
    const input: CanonicalLead = { email: "A@B.CO" };
    normalizeCanonical(input);
    expect(input.email).toBe("A@B.CO");
  });

  it("leaves leads without optional fields intact", () => {
    const out = normalizeCanonical({ phone: "9876543210" });
    expect(out.canonical.phone).toBe("9876543210");
    expect(out.dedupEmailHash).toBeUndefined();
    expect(out.dedupPhoneHash).toBeDefined();
  });
});

function normalizeValid() {
  return normalizeCanonical({
    ...valid,
    email: VALID_EMAIL.trim(),
    currency: "usd",
  });
}
