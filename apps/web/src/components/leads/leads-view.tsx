"use client";

import { useEffect, useState } from "react";
import type { LeadStatus } from "@middleware/types";
import { PageHeader } from "@/components/page-header";
import { LeadsTable } from "@/components/leads/leads-table";
import { LeadsToolbar, type LeadFilters } from "@/components/leads/leads-toolbar";
import { Card } from "@/components/ui/card";
import { leadRows, useLeadList } from "@/lib/queries/leads";
import { useSources } from "@/lib/queries/integrations";
import { formatNumber } from "@/lib/format";

export interface LeadsViewProps {
  title: string;
  description?: string;
  /** Fixed status filter applied by preset pages (Processing/Delivered/Failed). */
  presetStatus?: LeadStatus;
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Shared leads list: filter toolbar + cursor-paginated table.
 * Search input is debounced (300ms) before it hits the API.
 */
export function LeadsView({
  title,
  description,
  presetStatus,
  emptyTitle,
  emptyDescription,
}: LeadsViewProps) {
  const [searchValue, setSearchValue] = useState("");
  const [filters, setFilters] = useState<LeadFilters>({});
  const [debouncedSearch, setDebouncedSearch] = useState("");

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

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={title}
        description={
          description ?? (
            <>
              {leads.data ? `${formatNumber(rows.length)} loaded` : "Loading…"} · cursor
              pagination with server-side filters.
            </>
          )
        }
      />

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
