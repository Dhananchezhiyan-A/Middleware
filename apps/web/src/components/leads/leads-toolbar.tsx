"use client";

import { Search, X } from "lucide-react";
import { LeadStatuses, type LeadStatus } from "@middleware/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectSm } from "@/components/ui/select";
import type { SourceItem } from "@/lib/types";

export interface LeadFilters {
  status?: LeadStatus;
  sourceId?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface LeadsToolbarProps {
  filters: LeadFilters;
  onChange: (next: LeadFilters) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  sources: SourceItem[];
  /** When a preset status is applied (Processing/Delivered/Failed pages). */
  hideStatus?: boolean;
}

function toDateInput(value: string | undefined): string {
  return value ? value.slice(0, 10) : "";
}

/** Converts a YYYY-MM-DD picker value into a full ISO instant (local time). */
function toIso(date: string, endOfDay: boolean): string | undefined {
  if (!date) return undefined;
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  const parsed = new Date(`${date}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function LeadsToolbar({
  filters,
  onChange,
  searchValue,
  onSearchChange,
  sources,
  hideStatus = false,
}: LeadsToolbarProps) {
  const hasFilters =
    Boolean(filters.status) || Boolean(filters.sourceId) || Boolean(filters.from) || Boolean(filters.to) || Boolean(filters.q);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search name, email, phone, id…"
          aria-label="Search leads"
          className="h-8 pl-8 text-xs"
        />
      </div>

      {hideStatus ? null : (
        <SelectSm
          aria-label="Filter by status"
          className="w-[140px]"
          value={filters.status ?? ""}
          onChange={(event) =>
            onChange({ ...filters, status: (event.target.value || undefined) as LeadStatus | undefined })
          }
        >
          <option value="">All statuses</option>
          {LeadStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </SelectSm>
      )}

      <SelectSm
        aria-label="Filter by source"
        className="w-[170px]"
        value={filters.sourceId ?? ""}
        onChange={(event) => onChange({ ...filters, sourceId: event.target.value || undefined })}
      >
        <option value="">All sources</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </SelectSm>

      <Input
        type="date"
        aria-label="From date"
        value={toDateInput(filters.from)}
        onChange={(event) => onChange({ ...filters, from: toIso(event.target.value, false) })}
        className="h-8 w-[150px] text-xs"
      />
      <Input
        type="date"
        aria-label="To date"
        value={toDateInput(filters.to)}
        onChange={(event) => onChange({ ...filters, to: toIso(event.target.value, true) })}
        className="h-8 w-[150px] text-xs"
      />

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({});
            onSearchChange("");
          }}
        >
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
