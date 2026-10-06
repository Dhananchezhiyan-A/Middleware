"use client";

import { MoreHorizontal, Pencil, Trash2, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceIdValue } from "@/components/sources/source-id-value";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { formatDateTime, formatNumber } from "@/lib/format";
import type { SourceItem } from "@/lib/types";

export interface SourcesTableProps {
  rows: SourceItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** UX-only gating — the API enforces sources:write server-side. */
  canWrite: boolean;
  onAccounts: (source: SourceItem) => void;
  onEdit: (source: SourceItem) => void;
  onDelete: (source: SourceItem) => void;
}

export function SourcesTable({
  rows,
  isLoading,
  error,
  onRetry,
  canWrite,
  onAccounts,
  onEdit,
  onDelete,
}: SourcesTableProps) {
  if (isLoading) return <TableSkeleton rows={5} cols={7} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No sources yet"
        description="A source is an inbound channel — a webhook, API, form or file that produces leads."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="w-55">Source ID</TableHead>
          <TableHead className="w-[140px]">Type</TableHead>
          <TableHead className="w-[180px]">Code</TableHead>
          <TableHead className="w-[100px] text-right">Accounts</TableHead>
          <TableHead className="w-[100px] text-right">Leads</TableHead>
          <TableHead className="w-[150px]">Created</TableHead>
          <TableHead className="w-[48px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((source) => (
          <TableRow key={source.id}>
            <TableCell>
              <p className="truncate font-medium">{source.name}</p>
            </TableCell>
            <TableCell>
              <SourceIdValue id={source.id} />
            </TableCell>
            <TableCell>
              <Badge variant="outline">{source.type}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{source.code}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(source._count?.accounts)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(source._count?.leads)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(source.createdAt)}
            </TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${source.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{source.code}</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => onAccounts(source)}>
                    <Webhook /> Inbound accounts
                  </DropdownMenuItem>
                  {canWrite ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onEdit(source)}>
                        <Pencil /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onDelete(source)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
