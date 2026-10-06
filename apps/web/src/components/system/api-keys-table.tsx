"use client";

import { KeyRound, Trash2 } from "lucide-react";
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
import { EMPTY, formatDateTime, formatRelative } from "@/lib/format";
import type { ApiKeyListItem } from "@/lib/types";

export interface ApiKeysTableProps {
  rows: ApiKeyListItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  canWrite: boolean;
  onRevoke: (key: ApiKeyListItem) => void;
}

export function ApiKeysTable({
  rows,
  isLoading,
  error,
  onRetry,
  canWrite,
  onRevoke,
}: ApiKeysTableProps) {
  if (isLoading) return <TableSkeleton rows={4} cols={6} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No API keys"
        icon={<KeyRound className="size-5" />}
        description="API keys authenticate machine-to-machine calls via the x-api-key header. The raw key is shown once at creation."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="w-[170px]">Key</TableHead>
          <TableHead className="w-[110px]">Status</TableHead>
          <TableHead className="w-[150px]">Last used</TableHead>
          <TableHead className="w-[150px]">Expires</TableHead>
          <TableHead className="w-[150px]">Created</TableHead>
          <TableHead className="w-[48px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((key) => (
          <TableRow key={key.id}>
            <TableCell>
              <p className="truncate font-medium">{key.name}</p>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {key.keyPrefix}…
            </TableCell>
            <TableCell>
              <Badge variant={key.status === "ACTIVE" ? "success" : "secondary"}>
                {key.status}
              </Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {key.lastUsedAt ? formatRelative(key.lastUsedAt) : EMPTY}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {key.expiresAt ? formatDateTime(key.expiresAt) : "never"}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(key.createdAt)}
            </TableCell>
            <TableCell className="text-right">
              {canWrite && key.status === "ACTIVE" ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revoke ${key.name}`}
                  onClick={() => onRevoke(key)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
