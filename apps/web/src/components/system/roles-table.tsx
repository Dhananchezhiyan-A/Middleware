"use client";

import { Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import type { RoleListItem } from "@/lib/types";

export interface RolesTableProps {
  rows: RoleListItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  canWrite: boolean;
  onEdit: (role: RoleListItem) => void;
  onDelete: (role: RoleListItem) => void;
}

export function RolesTable({
  rows,
  isLoading,
  error,
  onRetry,
  canWrite,
  onEdit,
  onDelete,
}: RolesTableProps) {
  if (isLoading) return <TableSkeleton rows={4} cols={6} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No roles"
        description="Roles bundle permissions; the built-in defaults are admin, manager, developer and viewer."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Role</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-[110px] text-right">Permissions</TableHead>
          <TableHead className="w-[90px] text-right">Members</TableHead>
          <TableHead className="w-[150px]">Created</TableHead>
          <TableHead className="w-[48px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((role) => (
          <TableRow key={role.id}>
            <TableCell>
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{role.name}</span>
                {role.isSystem ? (
                  <Badge variant="secondary">
                    <ShieldCheck className="size-3" /> system
                  </Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="max-w-[320px]">
              <span className="block truncate text-xs text-muted-foreground" title={role.description ?? ""}>
                {role.description || "—"}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(role.permissions.length)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(role.userCount)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(role.createdAt)}
            </TableCell>
            <TableCell className="text-right">
              {canWrite && !role.isSystem ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${role.name}`}>
                      <Pencil />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onEdit(role)}>
                      <Pencil /> Edit role
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => onDelete(role)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 /> Delete role
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
