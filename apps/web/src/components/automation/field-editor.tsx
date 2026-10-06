"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldMappingField } from "@/lib/types";

export interface FieldRow {
  source: string;
  target: string;
  required: boolean;
}

export function emptyRow(): FieldRow {
  return { source: "", target: "", required: false };
}

/**
 * Rows → API `fields[]`. Returns an error string when a row is incomplete
 * instead of sending half-filled pairs the server would reject.
 */
export function rowsToFields(rows: FieldRow[]): { fields: FieldMappingField[]; error: string | null } {
  const usable = rows.filter((row) => row.source.trim() || row.target.trim());
  if (usable.length === 0) {
    return { fields: [], error: "Add at least one source → target pair." };
  }
  for (const [index, row] of usable.entries()) {
    if (!row.source.trim() || !row.target.trim()) {
      return { fields: [], error: `Row ${index + 1}: both source and target are required.` };
    }
  }
  return {
    fields: usable.map((row) => ({
      source: row.source.trim(),
      target: row.target.trim(),
      ...(row.required ? { required: true } : {}),
    })),
    error: null,
  };
}

export function fieldsToRows(fields: FieldMappingField[] | undefined): FieldRow[] {
  if (!fields || fields.length === 0) return [emptyRow()];
  return fields.map((field) => ({
    source: field.source,
    target: field.target,
    required: Boolean(field.required),
  }));
}

export interface FieldEditorProps {
  rows: FieldRow[];
  onChange: (rows: FieldRow[]) => void;
  disabled?: boolean;
}

/** Compact source → target pair editor used by the mapping create/version flows. */
export function FieldEditor({ rows, onChange, disabled = false }: FieldEditorProps) {
  const update = (index: number, patch: Partial<FieldRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-[11px] font-medium text-muted-foreground">
        <span>Source field</span>
        <span>Target field</span>
        <span className="w-14 text-center">Required</span>
        <span className="w-8" />
      </div>

      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
          <Input
            value={row.source}
            onChange={(event) => update(index, { source: event.target.value })}
            placeholder="email"
            disabled={disabled}
            className="font-mono text-xs"
          />
          <Input
            value={row.target}
            onChange={(event) => update(index, { target: event.target.value })}
            placeholder="email_address"
            disabled={disabled}
            className="font-mono text-xs"
          />
          <label className="flex w-14 justify-center">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={row.required}
              disabled={disabled}
              onChange={(event) => update(index, { required: event.target.checked })}
              aria-label={`Row ${index + 1} required`}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove row ${index + 1}`}
            disabled={disabled || rows.length === 1}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <X />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...rows, emptyRow()])}
      >
        <Plus /> Add field
      </Button>
    </div>
  );
}
