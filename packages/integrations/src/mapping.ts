import type { CanonicalLead, FieldMappingField, FieldTransform } from "@middleware/types";

/**
 * Field mapping engine:
 *
 *   Source field → Canonical Lead → Destination field
 *
 * Mappings are DATA (FieldMappingVersion.fields), never hardcoded business
 * logic. New destination fields require configuration, not deploys.
 */

export interface MappingContext {
  lead: CanonicalLead;
  score?: number;
}

export interface MappingOutcome {
  data: Record<string, unknown>;
  /** Required destination fields that resolved to nothing: "src→target". */
  missingRequired: string[];
  appliedCount: number;
}

/** Resolves a dotted source path against the canonical lead context. */
export function resolveSourcePath(path: string, ctx: MappingContext): unknown {
  let p = path.trim();
  if (p.startsWith("lead.")) p = p.slice(5);
  if (p.startsWith("canonical.")) p = p.slice(10);

  if (p.startsWith("custom.")) {
    const key = p.slice(7);
    return ctx.lead.custom?.[key];
  }
  if (p === "score") return ctx.score;

  const segments = p.split(".");
  let current: unknown = ctx.lead;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** Renders {{path}} placeholders from the mapping context. */
export function renderTemplate(template: string, ctx: MappingContext): string {
  return template.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_m, path: string) => {
    const value = resolveSourcePath(path, ctx);
    return isEmpty(value) ? "" : String(value);
  });
}

function applyTransform(value: unknown, t: FieldTransform, ctx: MappingContext): unknown {
  switch (t.type) {
    case "uppercase":
      return value === undefined ? value : String(value).toUpperCase();
    case "lowercase":
      return value === undefined ? value : String(value).toLowerCase();
    case "trim":
      return value === undefined ? value : String(value).trim();
    case "template":
      return renderTemplate(t.template, ctx);
    case "coerce_number": {
      const n = Number(String(value ?? "").replace(/,/g, ""));
      return Number.isNaN(n) ? undefined : n;
    }
    case "coerce_string":
      return value === undefined || value === null ? undefined : String(value);
    case "coerce_boolean": {
      const s = String(value ?? "").toLowerCase();
      return ["true", "1", "yes", "y"].includes(s);
    }
    case "slice":
      return value === undefined ? value : String(value).slice(t.start, t.end);
    case "replace": {
      const s = String(value ?? "");
      if (t.regex) return s.replace(new RegExp(t.search, "g"), t.replace);
      return s.split(t.search).join(t.replace);
    }
    case "default_if_empty":
      return isEmpty(value) ? t.value : value;
    case "prefix":
      return value === undefined ? value : `${t.value}${String(value)}`;
    case "suffix":
      return value === undefined ? value : `${String(value)}${t.value}`;
    case "phone_e164": {
      if (value === undefined || value === null) return undefined;
      let digits = String(value).replace(/[^\d+]/g, "");
      if (digits.startsWith("+")) return digits;
      digits = digits.replace(/^0+/, "");
      return `+${t.defaultCountry}${digits}`;
    }
    case "split_name":
      // Handled at the field level (writes two targets).
      return value;
    default: {
      const never: never = t;
      return never;
    }
  }
}

/**
 * Applies a mapping definition to a canonical lead.
 *
 * - Unknown source paths resolve to undefined (skipped unless required).
 * - `defaultValue` fills empty values before transforms.
 * - Required fields that still resolve empty are reported, never silently
 *   dropped — the caller decides whether to fail the delivery.
 */
export function applyFieldMapping(
  fields: FieldMappingField[],
  ctx: MappingContext,
): MappingOutcome {
  const data: Record<string, unknown> = {};
  const missingRequired: string[] = [];
  let appliedCount = 0;

  for (const field of fields) {
    const transforms = field.transforms ?? [];
    const split = transforms.find((t) => t.type === "split_name");

    if (split && split.type === "split_name") {
      const raw = resolveSourcePath(split.from, ctx);
      const full = isEmpty(raw) ? field.defaultValue : raw;
      if (isEmpty(full)) {
        if (field.required) missingRequired.push(`${split.from}→${split.firstTarget}`);
        continue;
      }
      const parts = String(full).trim().split(/\s+/);
      const first = parts[0] ?? "";
      const last = parts.slice(1).join(" ");
      const rest = transforms.filter((t) => t.type !== "split_name");
      const firstVal = rest.reduce<unknown>((v, t) => applyTransform(v, t, ctx), first);
      const lastVal = rest.reduce<unknown>((v, t) => applyTransform(v, t, ctx), last);
      if (!isEmpty(firstVal)) data[split.firstTarget] = firstVal;
      if (!isEmpty(lastVal)) data[split.lastTarget] = lastVal;
      appliedCount += 1;
      continue;
    }

    let value = resolveSourcePath(field.source, ctx);
    if (isEmpty(value) && field.defaultValue !== undefined) {
      value = field.defaultValue;
    }
    if (isEmpty(value)) {
      if (field.required) missingRequired.push(`${field.source}→${field.target}`);
      continue;
    }
    const finalValue = transforms.reduce<unknown>((v, t) => applyTransform(v, t, ctx), value);
    if (isEmpty(finalValue) && field.defaultValue === undefined) {
      if (field.required) missingRequired.push(`${field.source}→${field.target}`);
      continue;
    }
    data[field.target] = finalValue;
    appliedCount += 1;
  }

  return { data, missingRequired, appliedCount };
}
