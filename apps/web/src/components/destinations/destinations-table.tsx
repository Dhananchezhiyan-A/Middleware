"use client";

import { MoreHorizontal, Play, Pencil, Plug, KeyRound, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { healthVariant } from "@/lib/status";
import type { DestinationItem } from "@/lib/types";

export type DestinationAction =
  | "test"
  | "credentials"
  | "edit"
  | "toggle"
  | "delete";

export interface DestinationsTableProps {
  rows: DestinationItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  canWrite: boolean;
  canTest: boolean;
  onAction: (action: DestinationAction, destination: DestinationItem) => void;
}

export function DestinationsTable({
  rows,
  isLoading,
  error,
  onRetry,
  canWrite,
  canTest,
  onAction,
}: DestinationsTableProps) {
  if (isLoading) return <TableSkeleton rows={5} cols={6} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No destinations yet"
        description="A destination is where routed leads are delivered: a CRM, a custom API or a signed webhook."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="w-[130px]">Type</TableHead>
          <TableHead className="w-[140px]">Health</TableHead>
          <TableHead className="w-[130px]">Last check</TableHead>
          <TableHead className="w-[90px] text-right">Deliveries</TableHead>
          <TableHead className="w-[90px] text-right">Mappings</TableHead>
          <TableHead className="w-[140px]">Created</TableHead>
          <TableHead className="w-[48px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((destination) => {
          const health = destination.health ?? null;
          const status = health?.status ?? "NOT_CONFIGURED";
          return (
            <TableRow key={destination.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{destination.name}</p>
                  {destination.status === "DISABLED" ? (
                    <Badge variant="secondary">DISABLED</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {destination.rateLimitPerSec
                    ? `${formatNumber(destination.rateLimitPerSec)} req/s`
                    : "default rate limit"}
                </p>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{destination.type}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={healthVariant(status)}>{status}</Badge>
                {health?.lastError ? (
                  <p className="mt-0.5 max-w-[160px] truncate text-[11px] text-destructive" title={health.lastError}>
                    {health.lastError}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(health?.checkedAt)}
                {health?.lastLatencyMs !== null && health?.lastLatencyMs !== undefined ? (
                  <span className="ml-1 tabular-nums">({health.lastLatencyMs}ms)</span>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(destination._count?.deliveries)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(destination._count?.fieldMappings)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(destination.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${destination.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{destination.id}</DropdownMenuLabel>
                    {canTest ? (
                      <DropdownMenuItem onSelect={() => onAction("test", destination)}>
                        <Play /> Test connection
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => onAction("credentials", destination)}>
                      <KeyRound /> Credentials
                    </DropdownMenuItem>
                    {canWrite ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onAction("edit", destination)}>
                          <Pencil /> Configure
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAction("toggle", destination)}>
                          <Plug />
                          {destination.status === "ACTIVE" ? "Disable" : "Enable"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => onAction("delete", destination)}
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
          );
        })}
      </TableBody>
    </Table>
  );
}
