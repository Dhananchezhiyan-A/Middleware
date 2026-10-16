"use client";

import { CheckCheck, Send, X } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { selectionSummary, type LeadSelectionState } from "@/lib/selection";

export interface LeadSelectionBarProps {
  state: LeadSelectionState;
  /** Rows currently loaded in the table. */
  loadedCount: number;
  /** Total leads matching the active filters (null while unknown). */
  total: number | null;
  /** True when any filter/search criteria are active. */
  filtersActive: boolean;
  /** Permission to open the delivery dialog (leads:replay). */
  canSend: boolean;
  /** True while the server resolves the all-filtered snapshot. */
  creatingSelection: boolean;
  onClear: () => void;
  onSelectPage: () => void;
  onSelectFiltered: () => void;
  onSend: () => void;
}

/**
 * Selection summary + actions (spec: "3 leads selected" / "25 leads selected
 * on this page" / "850 filtered leads selected across all pages") and the
 * banner that offers upgrading a page selection to every filtered lead.
 */
export function LeadSelectionBar({
  state,
  loadedCount,
  total,
  filtersActive,
  canSend,
  creatingSelection,
  onClear,
  onSelectPage,
  onSelectFiltered,
  onSend,
}: LeadSelectionBarProps) {
  if (state.mode === "none") return null;

  const summary = selectionSummary(state, loadedCount);
  /** Offer upgrading a full page selection to every filtered lead. */
  const canUpgrade =
    state.mode === "page" &&
    filtersActive &&
    total !== null &&
    total > loadedCount &&
    state.ids.length === loadedCount;

  return (
    <div className="mb-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{summary}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X /> Clear Selection
          </Button>
          <Button variant="outline" size="sm" onClick={onSelectPage}>
            <CheckCheck /> Select Current Page
          </Button>
          {filtersActive && total !== null && total > loadedCount && state.mode !== "filtered" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onSelectFiltered}
              disabled={creatingSelection}
            >
              {creatingSelection ? "Selecting…" : `Select All Filtered Leads (${formatNumber(total)})`}
            </Button>
          ) : null}
          <Button size="sm" onClick={onSend} disabled={!canSend}>
            <Send /> Send Selected Leads
          </Button>
        </div>
      </div>

      {canUpgrade ? (
        <button
          type="button"
          onClick={onSelectFiltered}
          disabled={creatingSelection}
          className="mt-2 block w-full rounded-sm border border-dashed border-primary/40 bg-background px-2 py-1.5 text-left text-xs text-muted-foreground hover:border-primary/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {formatNumber(loadedCount)} lead{loadedCount === 1 ? "" : "s"} selected on this page.{" "}
          <span className="font-medium text-foreground">
            Select all {formatNumber(total)} matching leads.
          </span>
        </button>
      ) : null}
    </div>
  );
}
