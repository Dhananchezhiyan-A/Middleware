"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { FileUp } from "lucide-react";
import type { LeadStatus } from "@middleware/types";
import { ActiveFilter } from "@/components/active-filter";
import { PageHeader } from "@/components/page-header";
import { LeadsTable } from "@/components/leads/leads-table";
import { LeadsToolbar, type LeadFilters } from "@/components/leads/leads-toolbar";
import { LeadSelectionBar } from "@/components/leads/lead-selection-bar";
import { SendLeadsDialog } from "@/components/leads/send-leads-dialog";
import { DeliveryProgress } from "@/components/leads/delivery-progress";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { leadRows, useCreateSelection, useLeadList } from "@/lib/queries/leads";
import { useSources } from "@/lib/queries/integrations";
import { formatNumber } from "@/lib/format";
import type { ListFilterParams } from "@/lib/range";
import { QUICK_RANGE_LABELS, rangeFilterLabel, shortDate } from "@/lib/range";
import {
  emptySelection,
  isPageFullySelected,
  isRowSelected,
  sendPayload,
  selectionReducer,
  someOnPageSelected,
} from "@/lib/selection";
import type { ManualSendResult } from "@/lib/types";

export interface LeadsViewProps {
  title: string;
  description?: string;
  /** Fixed status filter applied by preset pages (Processing/Delivered/Failed). */
  presetStatus?: LeadStatus;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Filters read from the URL by the page (`?range=`, `?status=`, `?sourceId=`,
   * `?from=`, `?to=`, `?q=`, `?dateFrom=`, `?timeFrom=`, `?dateTo=`,
   * `?timeTo=`, `?quickRange=`) — how dashboard cards drill into this list
   * with their metric's filter already applied.
   */
  initialFilters?: ListFilterParams;
}

/** Session-only memory of the last manual send so results survive navigation. */
const LAST_SUBMISSION_KEY = "middleware:manual-send:last";

/** "Active filter" chips derived from the CURRENT criteria (not just the URL seed). */
function activeFilterChips(
  filters: LeadFilters,
  q: string | undefined,
  initial: ListFilterParams | undefined,
  sourceName?: string,
): string[] {
  const chips: string[] = [];

  if (filters.quickRange) {
    chips.push(`Received: ${QUICK_RANGE_LABELS[filters.quickRange]}`);
  } else if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom
      ? `${filters.dateFrom}${filters.timeFrom ? ` ${filters.timeFrom}` : ""}`
      : "";
    const to = filters.dateTo ? `${filters.dateTo}${filters.timeTo ? ` ${filters.timeTo}` : ""}` : "";
    if (from && to) chips.push(`Received: ${from} → ${to}`);
    else if (from) chips.push(`Received from: ${from}`);
    else chips.push(`Received until: ${to}`);
  } else if (initial?.range && filters.from === initial.from && filters.to === initial.to) {
    chips.push(rangeFilterLabel(initial.range));
  } else {
    if (filters.from) chips.push(`Received after: ${shortDate(filters.from)}`);
    if (filters.to) chips.push(`Received before: ${shortDate(filters.to)}`);
  }

  if (filters.status) chips.push(`Status: ${filters.status}`);
  if (filters.sourceId) chips.push(`Source: ${sourceName ?? filters.sourceId}`);
  if (q) chips.push(`Search: "${q}"`);

  return chips;
}

/**
 * Shared leads list: filter toolbar + cursor-paginated table.
 * Search input is debounced (300ms) before it hits the API.
 *
 * Filters live in component state AND are mirrored into the URL query string
 * (replace, no scroll) so a refresh or shared link keeps the exact criteria.
 * Selection (checkbox column) and the manual multi-CRM send flow are wired
 * here: page selections hold explicit IDs; "select all filtered" holds only
 * an opaque server-side snapshot token.
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
  const router = useRouter();
  const { can } = useAuth();
  const { toast } = useToast();
  const [searchValue, setSearchValue] = useState(initialFilters?.q ?? "");
  const [filters, setFilters] = useState<LeadFilters>({
    ...(initialFilters?.status ? { status: initialFilters.status as LeadStatus } : {}),
    ...(initialFilters?.sourceId ? { sourceId: initialFilters.sourceId } : {}),
    ...(initialFilters?.from ? { from: initialFilters.from } : {}),
    ...(initialFilters?.to ? { to: initialFilters.to } : {}),
    ...(initialFilters?.dateFrom ? { dateFrom: initialFilters.dateFrom } : {}),
    ...(initialFilters?.timeFrom ? { timeFrom: initialFilters.timeFrom } : {}),
    ...(initialFilters?.dateTo ? { dateTo: initialFilters.dateTo } : {}),
    ...(initialFilters?.timeTo ? { timeTo: initialFilters.timeTo } : {}),
    ...(initialFilters?.quickRange ? { quickRange: initialFilters.quickRange } : {}),
  });
  const [debouncedSearch, setDebouncedSearch] = useState(initialFilters?.q ?? "");

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
  const createSelection = useCreateSelection();

  const rows = leadRows(leads.data);
  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const total = leads.data?.pages[0]?.total ?? null;
  const sourceName = sources.data?.find((source) => source.id === filters.sourceId)?.name;
  const chips = activeFilterChips(filters, debouncedSearch || undefined, initialFilters, sourceName);
  const filtersActive = Boolean(
    params.status ||
      params.sourceId ||
      params.from ||
      params.to ||
      params.dateFrom ||
      params.dateTo ||
      params.quickRange ||
      params.q,
  );

  // --- Selection state (page vs all-filtered) ------------------------------
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        status: params.status ?? null,
        sourceId: params.sourceId ?? null,
        from: params.from ?? null,
        to: params.to ?? null,
        dateFrom: params.dateFrom ?? null,
        timeFrom: params.timeFrom ?? null,
        dateTo: params.dateTo ?? null,
        timeTo: params.timeTo ?? null,
        quickRange: params.quickRange ?? null,
        q: params.q ?? null,
      }),
    [
      params.status,
      params.sourceId,
      params.from,
      params.to,
      params.dateFrom,
      params.timeFrom,
      params.dateTo,
      params.timeTo,
      params.quickRange,
      params.q,
    ],
  );
  const [selection, dispatchSelection] = useReducer(selectionReducer, filterKey, emptySelection);

  // Criteria changed → the old selection may cover hidden leads: invalidate.
  useEffect(() => {
    dispatchSelection({ type: "reconcile", filterKey });
  }, [filterKey]);

  // --- URL mirror (refresh/share keeps the criteria) -----------------------
  const urlQueryString = useMemo(() => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.sourceId) query.set("sourceId", params.sourceId);
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.dateFrom) query.set("dateFrom", params.dateFrom);
    if (params.timeFrom) query.set("timeFrom", params.timeFrom);
    if (params.dateTo) query.set("dateTo", params.dateTo);
    if (params.timeTo) query.set("timeTo", params.timeTo);
    if (params.quickRange) query.set("quickRange", params.quickRange);
    if (params.q) query.set("q", params.q);
    return query.toString();
  }, [filterKey]);

  const lastUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const url = urlQueryString ? `${pathname}?${urlQueryString}` : pathname;
    if (lastUrlRef.current === null) {
      lastUrlRef.current = url; // mount: the URL already reflects initialFilters
      return;
    }
    if (lastUrlRef.current === url) return;
    lastUrlRef.current = url;
    router.replace(url, { scroll: false });
  }, [pathname, router, urlQueryString]);

  // --- Manual delivery flow ------------------------------------------------
  const canSend = can("leads:replay");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [submission, setSubmission] = useState<ManualSendResult | null>(null);

  // Restore the last submission's results after a refresh/navigation.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(LAST_SUBMISSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ManualSendResult;
      if (parsed && typeof parsed.submissionId === "string" && Array.isArray(parsed.destinations)) {
        setSubmission(parsed);
      }
    } catch {
      /* corrupted/absent — ignore */
    }
  }, []);

  const rememberSubmission = (result: ManualSendResult | null) => {
    setSubmission(result);
    try {
      if (result) window.sessionStorage.setItem(LAST_SUBMISSION_KEY, JSON.stringify(result));
      else window.sessionStorage.removeItem(LAST_SUBMISSION_KEY);
    } catch {
      /* storage unavailable — in-memory copy still works */
    }
  };

  const selectionFilters = useMemo(
    () => ({
      ...(params.status ? { status: params.status } : {}),
      ...(params.sourceId ? { sourceId: params.sourceId } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
      ...(params.timeFrom ? { timeFrom: params.timeFrom } : {}),
      ...(params.dateTo ? { dateTo: params.dateTo } : {}),
      ...(params.timeTo ? { timeTo: params.timeTo } : {}),
      ...(params.quickRange ? { quickRange: params.quickRange } : {}),
      ...(params.q ? { q: params.q } : {}),
    }),
    [filterKey],
  );

  const handleSelectFiltered = () => {
    createSelection.mutate(selectionFilters, {
      onSuccess: (data) => {
        dispatchSelection({ type: "set-filtered", token: data.token, count: data.count });
        toast({
          title: "All filtered leads selected",
          description: `${formatNumber(data.count)} leads matching the current filters are now selected.`,
        });
      },
      onError: (err) =>
        toast({ title: "Could not select the filtered leads", description: errorMessage(err), variant: "error" }),
    });
  };

  const handleSent = (result: ManualSendResult) => {
    rememberSubmission(result);
    dispatchSelection({ type: "clear" });
    toast({
      title: "Deliveries queued",
      description: `${formatNumber(result.created)} new deliveries queued for ${formatNumber(result.leadCount)} leads across ${formatNumber(result.destinations.length)} destination${result.destinations.length === 1 ? "" : "s"}.`,
    });
  };

  const clearAllFilters = () => {
    setFilters({});
    setSearchValue("");
    setDebouncedSearch("");
    dispatchSelection({ type: "clear" });
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={title}
        description={
          description ??
          <>
            {total !== null ? `${formatNumber(total)} matching · ` : ""}
            {leads.data ? `${formatNumber(rows.length)} loaded` : "Loading…"} · cursor
            pagination with server-side filters.
          </>
        }
        actions={
          // The import action belongs to the main Leads screen only, and only
          // for users the API would allow to actually start an import.
          pathname === "/leads" && can("imports:write") ? (
            <Link href="/leads/import">
              <Button size="sm">
                <FileUp /> Upload CSV
              </Button>
            </Link>
          ) : null
        }
      />

      {chips.length > 0 ? (
        <ActiveFilter chips={chips} clearHref={pathname} onClear={clearAllFilters} />
      ) : null}

      <LeadsToolbar
        filters={filters}
        onChange={setFilters}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        sources={sources.data ?? []}
        hideStatus={Boolean(presetStatus)}
      />

      {submission ? (
        <DeliveryProgress result={submission} onDismiss={() => rememberSubmission(null)} />
      ) : null}

      {canSend ? (
        <LeadSelectionBar
          state={selection}
          loadedCount={rows.length}
          total={total}
          filtersActive={filtersActive}
          canSend={sendPayload(selection) !== null}
          creatingSelection={createSelection.isPending}
          onClear={() => dispatchSelection({ type: "clear" })}
          onSelectPage={() => dispatchSelection({ type: "select-page", pageIds })}
          onSelectFiltered={handleSelectFiltered}
          onSend={() => setSendDialogOpen(true)}
        />
      ) : null}

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
          selection={
            canSend
              ? {
                  isSelected: (id: string) => isRowSelected(selection, id),
                  allSelected: isPageFullySelected(selection, pageIds),
                  someSelected: someOnPageSelected(selection, pageIds),
                  rowsDisabled: selection.mode === "filtered",
                  onToggleRow: (id: string) => dispatchSelection({ type: "toggle-row", id }),
                  onToggleAll: () => {
                    if (
                      selection.mode !== "none" &&
                      isPageFullySelected(selection, pageIds)
                    ) {
                      dispatchSelection({ type: "clear" });
                    } else {
                      dispatchSelection({ type: "select-page", pageIds });
                    }
                  },
                }
              : undefined
          }
        />
      </Card>

      {canSend ? (
        <SendLeadsDialog
          open={sendDialogOpen}
          onOpenChange={setSendDialogOpen}
          state={selection}
          filterChips={chips}
          onSent={handleSent}
        />
      ) : null}
    </div>
  );
}
