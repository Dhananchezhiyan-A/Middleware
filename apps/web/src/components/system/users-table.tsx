"use client";

import { Pencil } from "lucide-react";
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
import type { UserListItem } from "@/lib/types";

export interface UsersTableProps {
  rows: UserListItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  canWrite: boolean;
  onEdit: (user: UserListItem) => void;
}

function statusVariant(status: string) {
  switch (status) {
    case "ACTIVE":
      return "success" as const;
    case "INVITED":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

export function UsersTable({ rows, isLoading, error, onRetry, canWrite, onEdit }: UsersTableProps) {
  if (isLoading) return <TableSkeleton rows={5} cols={6} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No users"
        description="Invite teammates — each user gets a role that decides what they can do."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead className="w-[140px]">Role</TableHead>
          <TableHead className="w-[110px]">Status</TableHead>
          <TableHead className="w-[160px]">Last login</TableHead>
          <TableHead className="w-[160px]">Created</TableHead>
          <TableHead className="w-[48px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((user) => (
          <TableRow key={user.id}>
            <TableCell>
              <p className="truncate font-medium">{user.name || "—"}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{user.role.name}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {user.lastLoginAt ? formatRelative(user.lastLoginAt) : EMPTY}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(user.createdAt)}
            </TableCell>
            <TableCell className="text-right">
              {canWrite ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${user.email}`}
                  onClick={() => onEdit(user)}
                >
                  <Pencil />
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
