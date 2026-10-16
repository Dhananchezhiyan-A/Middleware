"use client";

import { useEffect, useRef, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime, EMPTY } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TableSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeadListItem } from "@/lib/types";

/** Checkbox-column wiring; omit the whole prop to render the plain table. */
export interface LeadsTableSelection {
  /** True when the lead is selected (a filtered snapshot selects every row). */
  isSelected: (id: string) => boolean;
  /** Header checkbox state — selects/deselects the CURRENT page. */
  allSelected: boolean;
  someSelected: boolean;
  /** When true the snapshot covers all matching leads — rows are display-only. */
  rowsDisabled: boolean;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
}

export interface LeadsTableProps {
  rows: LeadListItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  selection?: LeadsTableSelection;
}

/** Native checkbox with a proper indeterminate state (React can't set it via JSX). */
function SelectCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  onToggle,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      className="size-4 cursor-pointer accent-primary disabled:cursor-default"
      onClick={(event) => event.stopPropagation()}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}

function contactCell(lead: LeadListItem): { primary: string; secondary: string } {
  const name =
    lead.canonicalData.name?.full ||
    [lead.canonicalData.name?.first, lead.canonicalData.name?.last].filter(Boolean).join(" ") ||
    lead.externalLeadId ||
    EMPTY;
  const secondary = [lead.canonicalData.email, lead.canonicalData.phone].filter(Boolean).join(" · ");
  return { primary: name, secondary: secondary || EMPTY };
}

export function LeadsTable({
  rows,
  isLoading,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  emptyTitle = "No leads found",
  emptyDescription = "Leads matching the current filters will appear here.",
  selection,
}: LeadsTableProps) {
  const router = useRouter();

  if (isLoading) return <TableSkeleton rows={8} cols={selection ? 6 : 5} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            {selection ? (
              <TableHead className="w-10">
                <SelectCheckbox
                  checked={selection.allSelected}
                  indeterminate={!selection.allSelected && selection.someSelected}
                  label={
                    selection.allSelected
                      ? "Deselect all leads on this page"
                      : "Select all leads on this page"
                  }
                  onToggle={selection.onToggleAll}
                />
              </TableHead>
            ) : null}
            <TableHead className="w-[170px]">ID</TableHead>
            <TableHead className="w-[130px]">Lead ID</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="w-[150px]">Received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((lead) => {
            const contact = contactCell(lead);
            return (
              <TableRow
                key={lead.id}
                className="cursor-pointer"
                onClick={() => router.push(`/leads/${lead.id}`)}
              >
                {selection ? (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <SelectCheckbox
                      checked={selection.isSelected(lead.id)}
                      disabled={selection.rowsDisabled}
                      label={
                        selection.rowsDisabled
                          ? "Covered by the all-filtered selection"
                          : `Select lead ${lead.leadId}`
                      }
                      onToggle={() => selection.onToggleRow(lead.id)}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {lead.id}
                </TableCell>
                <TableCell className="font-mono text-xs font-medium">{lead.leadId}</TableCell>
                <TableCell>
                  <p className="truncate font-medium">{contact.primary}</p>
                  <p className="truncate text-xs text-muted-foreground">{contact.secondary}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{lead.source.name}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDateTime(lead.receivedAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-3">
        <span className="text-[11px] text-muted-foreground">
          {rows.length} lead{rows.length === 1 ? "" : "s"} loaded
        </span>
        {hasNextPage ? (
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">End of results</span>
        )}
      </div>
    </div>
  );
}
