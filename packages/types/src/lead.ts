/**
 * Canonical Lead — the source-independent representation every stage of the
 * pipeline operates on.
 *
 *   Source payload → (normalize) → CanonicalLead → (map) → Destination payload
 */

export interface CanonicalName {
  first?: string;
  last?: string;
  full?: string;
}

export interface CanonicalLocation {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

export interface CanonicalSourceInfo {
  /** Original provider campaign name/id. */
  campaign?: string;
  adGroup?: string;
  ad?: string;
  medium?: string;
  content?: string;
  term?: string;
  /** Landing page / form URL. */
  pageUrl?: string;
}

export interface CanonicalConsent {
  status?: string;
  text?: string;
  url?: string;
  collectedAt?: string;
}

export interface CanonicalLead {
  name?: CanonicalName;
  email?: string;
  emailAlt?: string;
  phone?: string;
  phoneAlt?: string;
  company?: string;
  jobTitle?: string;
  currency?: string;
  /** Budget in minor-unit-agnostic decimal; currency tells the unit. */
  budget?: number;
  location?: CanonicalLocation;
  sourceInfo?: CanonicalSourceInfo;
  consent?: CanonicalConsent;
  /** Project / development name (real-estate vertical). */
  project?: string;
  /** Free-form UTM and provider fields preserved verbatim. */
  custom?: Record<string, unknown>;
  /**
   * The untouched normalized view of the original payload (pre-canonical).
   * Kept alongside canonical data for tracing and mapping configuration.
   */
  raw?: Record<string, unknown>;
}

/** A single mapping instruction: source → canonical → destination. */
export interface FieldMappingField {
  /** Canonical path, e.g. "email" | "name.first" | "custom.budget_range". */
  source: string;
  /** Destination field name, e.g. "Email" | "FirstName". */
  target: string;
  required?: boolean;
  /** Applied when the resolved source value is undefined/null/"". */
  defaultValue?: string | number | boolean;
  transforms?: FieldTransform[];
}

// ---------------------------------------------------------------------------
// Canonical Lead field catalog — UI metadata for the fields a field mapping
// may read (FieldMappingField.source).
//
// SINGLE SOURCE OF TRUTH: every `key` below is exactly a path that
// `resolveSourcePath()` (packages/integrations/src/mapping.ts) can walk in the
// { lead, score } mapping context:
//
//   canonical leaf of CanonicalLead   "email" | "name.first" | "location.city"
//   computed score                    "score"
//   verbatim payload field            "custom.<payload key>"
//
// A key that does not resolve silently drops the value at delivery time, so
// nothing outside that set may be listed here. Groups + labels are pure
// presentation metadata for the picker; the stored value is always `key`.
// ---------------------------------------------------------------------------

export type LeadFieldCategory =
  | "contact"
  | "personal"
  | "address"
  | "company"
  | "lead"
  | "campaign"
  | "requirements"
  | "attribution"
  | "consent";

export interface LeadFieldCategoryDefinition {
  id: LeadFieldCategory;
  label: string;
}

/** Value type of a canonical lead field — drives which operators are valid. */
export type LeadFieldType = "text" | "number" | "date" | "enum";

export interface LeadFieldDefinition {
  /** Canonical path stored verbatim in `FieldMappingField.source`. */
  key: string;
  /** Human-readable label shown in the picker (never stored). */
  label: string;
  category: LeadFieldCategory;
  /** Value type: routing/scoring builders only offer valid operators for it. */
  type: LeadFieldType;
  /** Synonyms matched by the picker search in addition to label + key. */
  keywords?: string;
}

/** Display order of the groups in the source-field picker. */
export const LEAD_FIELD_CATEGORIES: readonly LeadFieldCategoryDefinition[] = [
  { id: "contact", label: "Contact" },
  { id: "personal", label: "Personal" },
  { id: "address", label: "Address" },
  { id: "company", label: "Company" },
  { id: "lead", label: "Lead" },
  { id: "campaign", label: "Campaign" },
  { id: "requirements", label: "Requirements" },
  { id: "attribution", label: "Attribution" },
  { id: "consent", label: "Consent" },
];

export const LEAD_FIELDS: readonly LeadFieldDefinition[] = [
  // --- CONTACT -------------------------------------------------------------
  { key: "name.first", label: "First name", category: "contact", type: "text", keywords: "firstName given name" },
  { key: "name.last", label: "Last name", category: "contact", type: "text", keywords: "lastName family surname" },
  { key: "name.full", label: "Full name", category: "contact", type: "text", keywords: "fullName contact name" },
  { key: "email", label: "Email", category: "contact", type: "text", keywords: "email address mail" },
  { key: "emailAlt", label: "Alternate email", category: "contact", type: "text", keywords: "secondary email" },
  { key: "phone", label: "Phone", category: "contact", type: "text", keywords: "phone number mobile" },
  { key: "phoneAlt", label: "Alternate phone", category: "contact", type: "text", keywords: "alternate phone secondary mobile" },
  { key: "custom.mobile", label: "Mobile", category: "contact", type: "text", keywords: "mobile phone cell number" },

  // --- PERSONAL ------------------------------------------------------------
  { key: "custom.gender", label: "Gender", category: "personal", type: "enum", keywords: "gender sex" },
  { key: "custom.dateOfBirth", label: "Date of birth", category: "personal", type: "date", keywords: "dob birthday age" },

  // --- ADDRESS -------------------------------------------------------------
  { key: "location.line1", label: "Address line 1", category: "address", type: "text", keywords: "address street line" },
  { key: "location.line2", label: "Address line 2", category: "address", type: "text", keywords: "address street line" },
  { key: "custom.address", label: "Address", category: "address", type: "text", keywords: "address street" },
  { key: "location.city", label: "City", category: "address", type: "text", keywords: "city town locality" },
  { key: "location.state", label: "State", category: "address", type: "text", keywords: "state region province" },
  { key: "location.country", label: "Country", category: "address", type: "text", keywords: "country code" },
  { key: "location.postalCode", label: "Postal code", category: "address", type: "text", keywords: "zip postcode zipcode" },

  // --- COMPANY -------------------------------------------------------------
  { key: "company", label: "Company", category: "company", type: "text", keywords: "company organization org" },
  { key: "jobTitle", label: "Job title", category: "company", type: "text", keywords: "job title role designation" },
  { key: "custom.website", label: "Website", category: "company", type: "text", keywords: "website url site web" },

  // --- LEAD ----------------------------------------------------------------
  { key: "custom.leadId", label: "Lead ID", category: "lead", type: "text", keywords: "lead id" },
  { key: "custom.externalLeadId", label: "External lead ID", category: "lead", type: "text", keywords: "external id reference" },
  { key: "custom.leadSource", label: "Lead source", category: "lead", type: "enum", keywords: "lead source origin" },
  { key: "custom.LeadSource", label: "LeadSource", category: "lead", type: "enum", keywords: "leadsource lead source salesforce" },
  { key: "custom.Secondary_source__c", label: "Secondary source", category: "lead", type: "enum", keywords: "secondary source salesforce" },
  { key: "custom.Tertiary_Source__c", label: "Tertiary source", category: "lead", type: "enum", keywords: "tertiary source salesforce" },
  { key: "custom.leadStatus", label: "Lead status", category: "lead", type: "enum", keywords: "lead status state" },
  { key: "score", label: "Score", category: "lead", type: "number", keywords: "score lead score points" },

  // --- CAMPAIGN ------------------------------------------------------------
  { key: "sourceInfo.campaign", label: "Campaign", category: "campaign", type: "text", keywords: "campaign name" },
  { key: "sourceInfo.adGroup", label: "Ad group", category: "campaign", type: "text", keywords: "ad group adgroup" },
  { key: "sourceInfo.ad", label: "Ad", category: "campaign", type: "text", keywords: "ad advertisement" },
  { key: "sourceInfo.pageUrl", label: "Page URL", category: "campaign", type: "text", keywords: "landing page form url" },
  { key: "custom.campaignId", label: "Campaign ID", category: "campaign", type: "text", keywords: "campaign id" },
  { key: "custom.campaignName", label: "Campaign name", category: "campaign", type: "text", keywords: "campaign name" },
  { key: "custom.adId", label: "Ad ID", category: "campaign", type: "text", keywords: "ad id" },
  { key: "custom.adName", label: "Ad name", category: "campaign", type: "text", keywords: "ad name" },
  { key: "custom.adSetId", label: "Ad set ID", category: "campaign", type: "text", keywords: "ad set adset id" },
  { key: "custom.adSetName", label: "Ad set name", category: "campaign", type: "text", keywords: "ad set adset name" },
  { key: "custom.formId", label: "Form ID", category: "campaign", type: "text", keywords: "form id" },
  { key: "custom.pageId", label: "Page ID", category: "campaign", type: "text", keywords: "page id" },

  // --- REQUIREMENTS --------------------------------------------------------
  { key: "budget", label: "Budget", category: "requirements", type: "number", keywords: "budget amount value" },
  { key: "currency", label: "Currency", category: "requirements", type: "text", keywords: "currency code" },
  { key: "project", label: "Project", category: "requirements", type: "text", keywords: "project development" },
  { key: "custom.Project_Interested__c", label: "Project interested", category: "requirements", type: "text", keywords: "project interested salesforce" },
  { key: "custom.preferredLocation", label: "Preferred location", category: "requirements", type: "text", keywords: "preferred location area" },
  { key: "custom.purpose", label: "Purpose", category: "requirements", type: "text", keywords: "purpose investment loan" },
  { key: "custom.possession", label: "Possession", category: "requirements", type: "text", keywords: "possession ready to move" },
  { key: "custom.requirements", label: "Requirements", category: "requirements", type: "text", keywords: "requirement need" },
  { key: "custom.message", label: "Message", category: "requirements", type: "text", keywords: "message enquiry comment" },
  { key: "custom.notes", label: "Notes", category: "requirements", type: "text", keywords: "notes remarks comment" },

  // --- ATTRIBUTION ---------------------------------------------------------
  { key: "sourceInfo.medium", label: "Medium", category: "attribution", type: "text", keywords: "medium utm" },
  { key: "sourceInfo.content", label: "Content", category: "attribution", type: "text", keywords: "content utm" },
  { key: "sourceInfo.term", label: "Term", category: "attribution", type: "text", keywords: "term keyword utm" },
  { key: "custom.utmSource", label: "UTM source", category: "attribution", type: "text", keywords: "utm source" },
  { key: "custom.utmMedium", label: "UTM medium", category: "attribution", type: "text", keywords: "utm medium" },
  { key: "custom.utmCampaign", label: "UTM campaign", category: "attribution", type: "text", keywords: "utm campaign" },
  { key: "custom.utmTerm", label: "UTM term", category: "attribution", type: "text", keywords: "utm term" },
  { key: "custom.utmContent", label: "UTM content", category: "attribution", type: "text", keywords: "utm content" },

  // --- CONSENT -------------------------------------------------------------
  { key: "consent.status", label: "Consent status", category: "consent", type: "enum", keywords: "consent opt in status" },
  { key: "consent.text", label: "Consent text", category: "consent", type: "text", keywords: "consent text" },
  { key: "consent.url", label: "Consent URL", category: "consent", type: "text", keywords: "consent url link" },
  { key: "consent.collectedAt", label: "Consent collected at", category: "consent", type: "date", keywords: "consent date time" },
];

/** Lookup helper for the picker (label for a stored key, unknown → null). */
export function findLeadField(key: string): LeadFieldDefinition | null {
  return LEAD_FIELDS.find((field) => field.key === key) ?? null;
}

/** Case-insensitive match of one field against a normalised picker query. */
export function matchesLeadField(field: LeadFieldDefinition, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    field.label.toLowerCase().includes(normalized) ||
    field.key.toLowerCase().includes(normalized) ||
    (field.keywords ?? "").toLowerCase().includes(normalized)
  );
}

/**
 * Picker search over the catalog (catalog order preserved). Empty query →
 * every field, which is what the "see all available Lead fields" flow needs.
 */
export function searchLeadFields(query: string): LeadFieldDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...LEAD_FIELDS];
  return LEAD_FIELDS.filter((field) => matchesLeadField(field, normalized));
}

export type FieldTransform =
  | { type: "uppercase" }
  | { type: "lowercase" }
  | { type: "trim" }
  | { type: "split_name"; from: string; firstTarget: string; lastTarget: string }
  | { type: "template"; template: string } // {{lead.name.first}}
  | { type: "coerce_number" }
  | { type: "coerce_string" }
  | { type: "coerce_boolean" }
  | { type: "slice"; start: number; end?: number }
  | { type: "replace"; search: string; replace: string; regex?: boolean }
  | { type: "default_if_empty"; value: string | number | boolean }
  | { type: "prefix"; value: string }
  | { type: "suffix"; value: string }
  | { type: "phone_e164"; defaultCountry: string };
