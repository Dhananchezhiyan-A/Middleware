"use client";

import { Eye, Trash2 } from "lucide-react";
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
import { formatDateTime, formatNumber } from "@/lib/format";
import type { FieldMappingListItem } from "@/lib/types";

export interface FieldMappingsTableProps {
  rows: FieldMappingListItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  canWrite: boolean;
  onVersions: (mapping: FieldMappingListItem) => void;
  onDelete: (mapping: FieldMappingListItem) => void;
}

function statusVariant(status: FieldMappingListItem["status"]) {
  switch (status) {
    case "ACTIVE":
      return "success" as const;
    case "DRAFT":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

export function FieldMappingsTable({
  rows,
  isLoading,
  error,
  onRetry,
  canWrite,
  onVersions,
  onDelete,
}: FieldMappingsTableProps) {
  if (isLoading) return <TableSkeleton rows={4} cols={6} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No field mappings"
        description="A mapping reshapes lead fields for one destination — create one to control exactly what is sent."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Destination</TableHead>
          <TableHead className="w-[110px]">Status</TableHead>
          <TableHead className="w-[100px] text-right">Versions</TableHead>
          <TableHead className="w-[150px]">Updated</TableHead>
          <TableHead className="w-[80px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((mapping) => (
          <TableRow key={mapping.id}>
            <TableCell>
              <p className="truncate font-medium">{mapping.name}</p>
            </TableCell>
            <TableCell>
              <p className="truncate text-xs">{mapping.destination.name}</p>
              <Badge variant="outline" className="mt-0.5">
                {mapping.destination.type}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(mapping.status)}>{mapping.status}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(mapping.versionCount)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(mapping.updatedAt)}
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Versions for ${mapping.name}`}
                onClick={() => onVersions(mapping)}
              >
                <Eye />
              </Button>
              {canWrite ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${mapping.name}`}
                  onClick={() => onDelete(mapping)}
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
