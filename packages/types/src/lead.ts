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
