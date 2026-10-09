import { describe, expect, it } from "vitest";
import {
  LEAD_FIELDS,
  LEAD_FIELD_CATEGORIES,
  findLeadField,
  searchLeadFields,
  type CanonicalLead,
  type LeadFieldDefinition,
} from "./lead";

/**
 * The picker writes `field.key` straight into `FieldMappingField.source`, and
 * `resolveSourcePath()` (packages/integrations) walks that path against the
 * { lead, score } mapping context. A key that is not a real path compiles and
 * saves fine but silently drops the value at delivery time, so this fixture
 * spells out every canonical leaf and the assertions below walk the catalog
 * against it.
 */
const canonicalFixture: CanonicalLead = {
  name: { first: "Ada", last: "Lovelace", full: "Ada Lovelace" },
  email: "ada@example.com",
  emailAlt: "ada.work@example.com",
  phone: "+15550001111",
  phoneAlt: "+15550002222",
  company: "Analytical Engines",
  jobTitle: "Engineer",
  currency: "USD",
  budget: 250000,
  location: {
    line1: "1 Main St",
    line2: "Apt 4",
    city: "Springfield",
    state: "IL",
    country: "US",
    postalCode: "62701",
  },
  sourceInfo: {
    campaign: "Summer",
    adGroup: "Retargeting",
    ad: "Hero",
    medium: "cpc",
    content: "banner",
    term: "buy flat",
    pageUrl: "https://example.com/form",
  },
  consent: {
    status: "granted",
    text: "I agree",
    url: "https://example.com/privacy",
    collectedAt: "2026-01-01T00:00:00.000Z",
  },
  project: "Skyline",
  // Every `custom.*` key the catalog offers, so none of them is a dead path.
  custom: Object.fromEntries(
    LEAD_FIELDS.filter((field) => field.key.startsWith("custom.")).map((field) => [
      field.key.slice("custom.".length),
      "value",
    ]),
  ),
  raw: {},
};

const SCORE = 42;

function resolvePath(lead: CanonicalLead, score: number, key: string): unknown {
  if (key === "score") return score;
  let current: unknown = lead;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

describe("lead field catalog", () => {
  it("offers every field exactly once, with a label distinct from the key", () => {
    const keys = LEAD_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of LEAD_FIELDS) {
      expect(field.key, "key must be trimmed and never the raw label").toBe(field.key.trim());
      expect(field.key).not.toBe("");
      expect(field.label).toBe(field.label.trim());
      expect(field.label).not.toBe("");
      expect(field.key).not.toBe(field.label);
    }
  });

  it("declares every category used by a field, and no empty category", () => {
    const declared = LEAD_FIELD_CATEGORIES.map((category) => category.id);
    expect(new Set(declared).size).toBe(declared.length);
    for (const field of LEAD_FIELDS) {
      expect(declared).toContain(field.category);
    }
    for (const id of declared) {
      expect(
        LEAD_FIELDS.some((field) => field.category === id),
        `category "${id}" has no fields`,
      ).toBe(true);
    }
  });

  it("resolves every key against a canonical lead", () => {
    for (const field of LEAD_FIELDS) {
      expect(
        resolvePath(canonicalFixture, SCORE, field.key),
        `"${field.key}" does not resolve in the mapping context`,
      ).toBeDefined();
    }
  });

  it("keeps legacy, non-catalog values distinguishable (they must still load)", () => {
    expect(findLeadField("email")).not.toBeNull();
    // Saved before the picker existed: rendered verbatim, never rewritten.
    expect(findLeadField("Name")).toBeNull();
    expect(findLeadField("Source account")).toBeNull();
    expect(findLeadField("email_address")).toBeNull();
  });
});

describe("searchLeadFields", () => {
  const labelsFor = (query: string) => searchLeadFields(query).map((field: LeadFieldDefinition) => field.label);

  it("returns the whole catalog for an empty query", () => {
    expect(searchLeadFields("")).toHaveLength(LEAD_FIELDS.length);
    expect(searchLeadFields("   ")).toHaveLength(LEAD_FIELDS.length);
  });

  it("matches Email when searching 'email'", () => {
    expect(labelsFor("email")).toContain("Email");
    expect(labelsFor("email")).toContain("Alternate email");
  });

  it("matches Phone, Mobile and Alternate phone when searching 'phone'", () => {
    const labels = labelsFor("phone");
    expect(labels).toContain("Phone");
    expect(labels).toContain("Mobile");
    expect(labels).toContain("Alternate phone");
  });

  it("matches the campaign fields when searching 'campaign'", () => {
    const labels = labelsFor("campaign");
    expect(labels).toContain("Campaign");
    expect(labels).toContain("Campaign ID");
    expect(labels).toContain("Campaign name");
    expect(labels).toContain("UTM campaign");
  });

  it("is case-insensitive and also matches the canonical key", () => {
    expect(labelsFor("EMAIL")).toContain("Email");
    expect(searchLeadFields("name.first").map((field) => field.key)).toContain("name.first");
    expect(searchLeadFields("custom.utmSource").map((field) => field.key)).toEqual([
      "custom.utmSource",
    ]);
  });

  it("returns nothing for an unknown query", () => {
    expect(searchLeadFields("zzzz-not-a-lead-field")).toEqual([]);
  });

  it("offers the exact-case Salesforce payload keys the lead push maps", () => {
    // Keys are matched against lead.custom with their payload casing intact,
    // so these must be listed verbatim — "custom.leadSource" would not resolve
    // a payload that sends "LeadSource".
    const keys = searchLeadFields("").map((field) => field.key);
    expect(keys).toContain("custom.LeadSource");
    expect(keys).toContain("custom.Secondary_source__c");
    expect(keys).toContain("custom.Tertiary_Source__c");
    expect(keys).toContain("custom.Project_Interested__c");
    expect(searchLeadFields("secondary").map((field) => field.key)).toContain(
      "custom.Secondary_source__c",
    );
  });
});
