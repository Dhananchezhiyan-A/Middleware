"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export interface FieldMappingFieldDraft {
  source: string;
  target: string;
  required: boolean;
  defaultValue?: string;
  transforms?: string;
}

export const EMPTY_FIELDS_JSON = "[]";

function parseFields(raw: string): FieldMappingFieldDraft[] | null {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        source: typeof row.source === "string" ? row.source : "",
        target: typeof row.target === "string" ? row.target : "",
        required: row.required === true,
        ...(row.defaultValue !== undefined ? { defaultValue: String(row.defaultValue) } : {}),
        ...(Array.isArray(row.transforms) && row.transforms.length > 0
          ? { transforms: JSON.stringify(row.transforms) }
          : {}),
      };
    });
  } catch {
    return null;
  }
}

function transformsOf(raw: string | undefined): unknown[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toFields(rows: FieldMappingFieldDraft[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      source: row.source.trim(),
      target: row.target.trim(),
      required: row.required,
      ...(row.defaultValue?.trim() ? { defaultValue: row.defaultValue.trim() } : {}),
      ...(transformsOf(row.transforms).length > 0 ? { transforms: transformsOf(row.transforms) } : {}),
    })),
    null,
    2,
  );
}

export interface FieldsEditorProps {
  /** Initial document. Remount the editor (key=…) when it should be re-read. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * Field mapping editor: structured rows over the raw JSON document.
 * The rows are local state so half-typed JSON is never wiped while typing;
 * switching to the raw view is lossless for anything that already parses.
 */
export function FieldsEditor({ value, onChange, disabled }: FieldsEditorProps) {
  const [mode, setMode] = useState<"rows" | "json">("rows");
  const [rows, setRows] = useState<FieldMappingFieldDraft[]>(() => parseFields(value) ?? []);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const document = jsonText ?? value;

  const commitRows = (next: FieldMappingFieldDraft[]) => {
    setRows(next);
    onChange(toFields(next));
  };

  const switchToRows = () => {
    try {
      const parsed = parseFields(document);
      if (parsed === null) throw new Error("not an array");
      setRows(parsed);
      setJsonText(toFields(parsed));
      onChange(toFields(parsed));
      setJsonError(null);
      setMode("rows");
    } catch {
      setJsonError("Fix the JSON before switching back to rows.");
    }
  };

  if (mode === "json") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel
            label="Fields (JSON)"
            hint="array of {source, target, required, defaultValue, transforms}"
          />
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={switchToRows}>
            Rows
          </Button>
        </div>
        <textarea
          value={document}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => {
            setJsonText(event.target.value);
            onChange(event.target.value);
            setJsonError(null);
          }}
          className="min-h-[16rem] w-full rounded-md border border-input bg-background p-3 font-mono text-[11px] leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {jsonError ? <p className="text-[11px] text-destructive">{jsonError}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel
          label="Field mappings"
          hint={`${rows.length} row${rows.length === 1 ? "" : "s"}`}
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setMode("json")}>
            Raw JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => commitRows([...rows, { source: "", target: "", required: false }])}
          >
            <Plus /> Add field
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No fields yet — add at least one mapping between a source key and its destination target.
        </p>
      ) : null}

      {rows.map((row, index) => {
        const transformsInvalid =
          row.transforms !== undefined &&
          row.transforms.trim() !== "" &&
          transformsOf(row.transforms).length === 0;
        return (
          <div
            key={index}
            className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background/40 p-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,0.8fr)_minmax(0,1.1fr)_auto]"
          >
            <Input
              disabled={disabled}
              placeholder="canonical.email"
              aria-label={`Row ${index + 1} source`}
              value={row.source}
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, source: event.target.value };
                commitRows(next);
              }}
            />
            <Input
              disabled={disabled}
              placeholder="email"
              aria-label={`Row ${index + 1} target`}
              value={row.target}
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, target: event.target.value };
                commitRows(next);
              }}
            />
            <label className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
              <Switch
                checked={row.required}
                disabled={disabled}
                onCheckedChange={(next) => {
                  const updated = [...rows];
                  updated[index] = { ...row, required: next };
                  commitRows(updated);
                }}
                ariaLabel={`Row ${index + 1} required`}
              />
              req
            </label>
            <Input
              disabled={disabled}
              placeholder="default"
              aria-label={`Row ${index + 1} default value`}
              value={row.defaultValue ?? ""}
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, defaultValue: event.target.value };
                commitRows(next);
              }}
            />
            <div className="space-y-1">
              <Input
                disabled={disabled}
                placeholder='[{"type":"uppercase"}]'
                aria-label={`Row ${index + 1} transforms`}
                className="h-9 font-mono text-[11px]"
                value={row.transforms ?? ""}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...row, transforms: event.target.value };
                  setRows(next);
                }}
                onBlur={(event) => {
                  if (!event.target.value.trim()) return;
                  const next = [...rows];
                  next[index] = { ...row, transforms: event.target.value };
                  commitRows(next);
                }}
              />
              {transformsInvalid ? (
                <p className="text-[11px] text-destructive">Invalid transform JSON</p>
              ) : null}
            </div>
            <div className="flex items-start">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={`Remove row ${index + 1}`}
                onClick={() => commitRows(rows.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
