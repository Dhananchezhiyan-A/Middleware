"use client";

import { useEffect, useState } from "react";
import type { LeadStatus } from "@middleware/types";
import { ActiveFilter } from "@/components/active-filter";
import { PageHeader } from "@/components/page-header";
import { LeadsTable } from "@/components/leads/leads-table";
import { LeadsToolbar, type LeadFilters } from "@/components/leads/leads-toolbar";
import { Card } from "@/components/ui/card";
import { leadRows, useLeadList } from "@/lib/queries/leads";
import { useSources } from "@/lib/queries/integrations";
import { formatNumber } from "@/lib/format";
import type { ListFilterParams } from "@/lib/range";
import { rangeFilterLabel, shortDate } from "@/lib/range";
import { usePathname } from "next/navigation";

export interface LeadsViewProps {
  title: string;
  description?: string;
  /** Fixed status filter applied by preset pages (Processing/Delivered/Failed). */
  presetStatus?: LeadStatus;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Filters read from the URL by the page (`?range=`, `?status=`, `?sourceId=`,
   * `?from=`, `?to=`, `?q=`) — how dashboard cards drill into this list with
   * their metric's filter already applied.
   */
  initialFilters?: ListFilterParams;
}

/** Builds the "Active Filter" chips for the drill-down that opened the page. */
function filterChips(initial: ListFilterParams | undefined, sourceName?: string): string[] {
  if (!initial) return [];
  const chips: string[] = [];

  if (initial.range) {
    chips.push(rangeFilterLabel(initial.range));
  } else if (initial.from || initial.to) {
    if (initial.from) chips.push(`Received after: ${shortDate(initial.from)}`);
    if (initial.to) chips.push(`Received before: ${shortDate(initial.to)}`);
  }
  if (initial.status) chips.push(`Status: ${initial.status}`);
  if (initial.sourceId) chips.push(`Source: ${sourceName ?? initial.sourceId}`);
  if (initial.q) chips.push(`Search: "${initial.q}"`);

  return chips;
}

/**
 * Shared leads list: filter toolbar + cursor-paginated table.
 * Search input is debounced (300ms) before it hits the API.
 *
 * URL-driven filters (`initialFilters`) seed the toolbar and are surfaced in
 * an "Active Filter" banner so a drill-down always shows what it filtered on.
 */
export function LeadsView({
  title,
  description,
  presetStatus,
  emptyTitle,
  emptyDescription,
  initialFilters,
}: LeadsViewProps) {
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState(initialFilters?.q ?? "");
  const [filters, setFilters] = useState<LeadFilters>({
    ...(initialFilters?.status ? { status: initialFilters.status as LeadStatus } : {}),
    ...(initialFilters?.sourceId ? { sourceId: initialFilters.sourceId } : {}),
    ...(initialFilters?.from ? { from: initialFilters.from } : {}),
    ...(initialFilters?.to ? { to: initialFilters.to } : {}),
  });
  const [debouncedSearch, setDebouncedSearch] = useState(initialFilters?.q ?? "");
  const [filterDismissed, setFilterDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchValue.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchValue]);

  const params = {
    ...filters,
    status: presetStatus ?? filters.status,
    q: debouncedSearch || undefined,
  };

  const leads = useLeadList(params);
  const sources = useSources();

  const rows = leadRows(leads.data);
  const sourceName = sources.data?.find((source) => source.id === initialFilters?.sourceId)?.name;
  const chips = filterChips(initialFilters, sourceName);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={title}
        description={
          description ??
          <>
            {leads.data ? `${formatNumber(rows.length)} loaded` : "Loading…"} · cursor
            pagination with server-side filters.
          </>
        }
      />

      {chips.length > 0 && !filterDismissed ? (
        <ActiveFilter
          chips={chips}
          clearHref={pathname}
          onClear={() => {
            setFilterDismissed(true);
            setFilters({});
            setSearchValue("");
            setDebouncedSearch("");
          }}
        />
      ) : null}

      <LeadsToolbar
        filters={filters}
        onChange={setFilters}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        sources={sources.data ?? []}
        hideStatus={Boolean(presetStatus)}
      />

      <Card>
        <LeadsTable
          rows={rows}
          isLoading={leads.isLoading}
          error={leads.error}
          onRetry={() => void leads.refetch()}
          hasNextPage={Boolean(leads.hasNextPage)}
          isFetchingNextPage={leads.isFetchingNextPage}
          onLoadMore={() => void leads.fetchNextPage()}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
        />
      </Card>
    </div>
  );
}
