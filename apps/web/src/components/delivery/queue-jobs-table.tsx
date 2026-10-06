"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JsonViewer } from "@/components/ui/json-viewer";
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
import { formatDateTime, truncate } from "@/lib/format";
import type { QueueJob } from "@/lib/queries/delivery";

export interface QueueJobsTableProps {
  rows: QueueJob[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  /** Column label for the timestamp (retryAt on the failed queue). */
  timestampLabel?: string;
}

/**
 * Raw BullMQ job rows (failed / dead-letter). Job payloads are rendered
 * verbatim — including per-queue `{ error }` entries when Redis is degraded.
 */
export function QueueJobsTable({
  rows,
  isLoading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  timestampLabel = "Created",
}: QueueJobsTableProps) {
  const [inspect, setInspect] = useState<QueueJob | null>(null);

  if (isLoading) return <TableSkeleton rows={5} cols={6} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job</TableHead>
            <TableHead className="w-[140px]">Queue</TableHead>
            <TableHead className="w-[90px] text-right">Attempts</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="w-[150px]">{timestampLabel}</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((job, index) => {
            if (job.error) {
              // Redis failure entry — surfaced verbatim, never zeroed out.
              return (
                <TableRow key={`error-${index}`}>
                  <TableCell colSpan={6} className="text-xs text-destructive">
                    {job.error}
                  </TableCell>
                </TableRow>
              );
            }
            const timestamp = job.retryAt ?? job.createdAt;
            return (
              <TableRow key={job.id ?? index}>
                <TableCell className="max-w-[260px]">
                  <p className="truncate font-mono text-xs" title={job.id ?? ""}>
                    {job.id ?? "—"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{job.name ?? "—"}</p>
                </TableCell>
                <TableCell className="font-mono text-xs">{job.queue ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{job.attemptsMade ?? 0}</TableCell>
                <TableCell className="max-w-[300px]">
                  <span className="block truncate text-xs text-destructive" title={job.failedReason ?? ""}>
                    {truncate(job.failedReason, 100) || "—"}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDateTime(timestamp)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="View job payload"
                    onClick={() => setInspect(job)}
                  >
                    <Eye />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={inspect !== null} onOpenChange={(next) => (!next ? setInspect(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Job payload</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {inspect?.failedReason ? (
              <p className="break-words text-xs text-destructive">{inspect.failedReason}</p>
            ) : null}
            <JsonViewer value={inspect?.data ?? null} emptyLabel="This job carries no payload." />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
