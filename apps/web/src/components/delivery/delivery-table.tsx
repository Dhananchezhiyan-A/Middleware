"use client";

import Link from "next/link";
import { RotateCw } from "lucide-react";
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
import { formatDateTime, formatNumber, truncate } from "@/lib/format";
import { deliveryStatusVariant } from "@/lib/status";
import type { DeliveryListItem } from "@/lib/types";

export interface DeliveryTableProps {
  rows: DeliveryListItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** UX-only gate — the API enforces deliveries:retry server-side. */
  canReplay: boolean;
  onReplay: (delivery: DeliveryListItem) => void;
  /** True while a replay mutation for some row is in flight. */
  replayPending?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** Replay only makes sense once a delivery has stopped moving on its own. */
function replayable(status: DeliveryListItem["status"]): boolean {
  return status === "FAILED" || status === "DEAD" || status === "SKIPPED";
}

export function DeliveryTable({
  rows,
  isLoading,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  canReplay,
  onReplay,
  replayPending = false,
  emptyTitle,
  emptyDescription,
}: DeliveryTableProps) {
  if (isLoading) return <TableSkeleton rows={6} cols={7} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle ?? "No deliveries"}
        description={
          emptyDescription ??
          "Deliveries appear here once a lead is routed to a destination."
        }
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Destination</TableHead>
          <TableHead className="w-[160px]">Lead</TableHead>
          <TableHead className="w-[120px]">Status</TableHead>
          <TableHead className="w-[110px] text-right">Attempts</TableHead>
          <TableHead>Error</TableHead>
          <TableHead className="w-[150px]">Updated</TableHead>
          <TableHead className="w-[90px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((delivery) => {
          const attempts = delivery._count?.attempts ?? delivery.attemptCount;
          return (
            <TableRow key={delivery.id}>
              <TableCell>
                <p className="truncate font-medium">{delivery.destination.name}</p>
                <Badge variant="outline" className="mt-0.5">
                  {delivery.destination.type}
                </Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/leads/${delivery.leadId}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {delivery.leadId.slice(-8)}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={deliveryStatusVariant[delivery.status]}>{delivery.status}</Badge>
                {(delivery.replayCount ?? 0) > 0 ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    replayed {delivery.replayCount}×
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(attempts)}
                <span className="text-muted-foreground">/{formatNumber(delivery.maxAttempts)}</span>
              </TableCell>
              <TableCell className="max-w-[260px]">
                {delivery.errorCode || delivery.errorMessage ? (
                  <span
                    className="block truncate text-xs text-destructive"
                    title={`${delivery.errorCode ?? ""} ${delivery.errorMessage ?? ""}`.trim()}
                  >
                    {delivery.errorCode ? (
                      <span className="font-mono">{delivery.errorCode}</span>
                    ) : null}
                    {delivery.errorCode && delivery.errorMessage ? " — " : null}
                    {truncate(delivery.errorMessage, 80)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(delivery.updatedAt)}
              </TableCell>
              <TableCell className="text-right">
                {canReplay && replayable(delivery.status) ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Replay delivery"
                    disabled={replayPending}
                    onClick={() => onReplay(delivery)}
                  >
                    <RotateCw />
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
        {hasNextPage ? (
          <TableRow>
            <TableCell colSpan={7} className="py-3 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
