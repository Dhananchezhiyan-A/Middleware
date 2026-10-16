"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { LeadStatuses, type LeadStatus } from "@middleware/types";
import {
  QUICK_RANGES,
  QUICK_RANGE_LABELS,
  receivedRangeIssues,
  type QuickRange,
} from "@middleware/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectSm } from "@/components/ui/select";
import type { SourceItem } from "@/lib/types";

export interface LeadFilters {
  status?: LeadStatus;
  sourceId?: string;
  /** Legacy rolling instants (dashboard drill-ins). */
  from?: string;
  to?: string;
  q?: string;
  /** Server-interpreted calendar filters (resolved in APP_TIMEZONE). */
  dateFrom?: string;
  timeFrom?: string;
  dateTo?: string;
  timeTo?: string;
  quickRange?: QuickRange;
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

interface ReceivedDraft {
  dateFrom: string;
  timeFrom: string;
  dateTo: string;
  timeTo: string;
  quickRange?: QuickRange;
}

const EMPTY_DRAFT: ReceivedDraft = { dateFrom: "", timeFrom: "", dateTo: "", timeTo: "" };

function toDateInput(value: string | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export function LeadsToolbar({
  filters,
  onChange,
  searchValue,
  onSearchChange,
  sources,
  hideStatus = false,
}: LeadsToolbarProps) {
  /**
   * Date/time fields are edited as a DRAFT and committed with "Apply Filters"
   * (validation runs before anything reaches the query). Quick ranges apply
   * immediately — they are one-click presets resolved server-side, so
   * "Today" means the same calendar day for every operator.
   */
  const [draft, setDraft] = useState<ReceivedDraft>({
    ...EMPTY_DRAFT,
    dateFrom: filters.dateFrom ?? "",
    timeFrom: filters.timeFrom ?? "",
    dateTo: filters.dateTo ?? "",
    timeTo: filters.timeTo ?? "",
    quickRange: filters.quickRange,
  });
  const [draftError, setDraftError] = useState<string | null>(null);

  // Committed filters (Clear button, URL restore, quick chips) re-seed the draft.
  useEffect(() => {
    setDraft({
      dateFrom: filters.dateFrom ?? "",
      timeFrom: filters.timeFrom ?? "",
      dateTo: filters.dateTo ?? "",
      timeTo: filters.timeTo ?? "",
      quickRange: filters.quickRange,
    });
    setDraftError(null);
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.quickRange,
  ]);

  const hasFilters =
    Boolean(filters.status) ||
    Boolean(filters.sourceId) ||
    Boolean(filters.from) ||
    Boolean(filters.to) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    Boolean(filters.quickRange) ||
    Boolean(filters.q);

  const updateDraft = (patch: Partial<ReceivedDraft>) => {
    setDraftError(null);
    // Typing a date/time replaces any quick range (they are mutually exclusive).
    setDraft((prev) => ({ ...prev, ...patch, quickRange: patch.quickRange ?? undefined }));
  };

  const applyDraft = () => {
    const issues = receivedRangeIssues({
      dateFrom: draft.dateFrom || undefined,
      timeFrom: draft.timeFrom || undefined,
      dateTo: draft.dateTo || undefined,
      timeTo: draft.timeTo || undefined,
      quickRange: draft.quickRange,
    });
    if (issues.length > 0) {
      setDraftError(issues[0]);
      return;
    }
    setDraftError(null);
    const hasDraft = Boolean(
      draft.dateFrom || draft.timeFrom || draft.dateTo || draft.timeTo || draft.quickRange,
    );
    if (hasDraft) {
      // Calendar filters replace legacy instants (they are mutually exclusive
      // server-side).
      onChange({
        ...filters,
        dateFrom: draft.dateFrom || undefined,
        timeFrom: draft.timeFrom || undefined,
        dateTo: draft.dateTo || undefined,
        timeTo: draft.timeTo || undefined,
        quickRange: draft.quickRange,
        from: undefined,
        to: undefined,
      });
    } else {
      onChange({
        ...filters,
        dateFrom: undefined,
        timeFrom: undefined,
        dateTo: undefined,
        timeTo: undefined,
        quickRange: undefined,
      });
    }
  };

  const applyQuickRange = (key: QuickRange) => {
    setDraftError(null);
    if (filters.quickRange === key) {
      // Clicking the active chip clears the received-range filter.
      onChange({
        ...filters,
        quickRange: undefined,
        dateFrom: undefined,
        timeFrom: undefined,
        dateTo: undefined,
        timeTo: undefined,
        from: undefined,
        to: undefined,
      });
      return;
    }
    onChange({
      ...filters,
      quickRange: key,
      dateFrom: undefined,
      timeFrom: undefined,
      dateTo: undefined,
      timeTo: undefined,
      from: undefined,
      to: undefined,
    });
  };

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
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
          value={draft.dateFrom || toDateInput(filters.from)}
          onChange={(event) => updateDraft({ dateFrom: event.target.value })}
          className="h-8 w-[150px] text-xs"
        />
        <Input
          type="time"
          aria-label="From time"
          value={draft.timeFrom}
          onChange={(event) => updateDraft({ timeFrom: event.target.value })}
          className="h-8 w-[110px] text-xs"
        />
        <Input
          type="date"
          aria-label="To date"
          value={draft.dateTo || toDateInput(filters.to)}
          onChange={(event) => updateDraft({ dateTo: event.target.value })}
          className="h-8 w-[150px] text-xs"
        />
        <Input
          type="time"
          aria-label="To time"
          value={draft.timeTo}
          onChange={(event) => updateDraft({ timeTo: event.target.value })}
          className="h-8 w-[110px] text-xs"
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
            <X /> Clear Filters
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {QUICK_RANGES.map((key) => (
          <Button
            key={key}
            variant={filters.quickRange === key ? "secondary" : "outline"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => applyQuickRange(key)}
          >
            {QUICK_RANGE_LABELS[key]}
          </Button>
        ))}

        <Button size="sm" className="h-7 px-3 text-xs" onClick={applyDraft}>
          Apply Filters
        </Button>

        {draftError ? (
          <p role="alert" className="text-xs text-destructive">
            {draftError}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">Times are in the server timezone.</p>
        )}
      </div>
    </div>
  );
}
