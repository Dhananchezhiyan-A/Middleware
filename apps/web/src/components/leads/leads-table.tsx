"use client";

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
}: LeadsTableProps) {
  const router = useRouter();

  if (isLoading) return <TableSkeleton rows={8} cols={5} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
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
