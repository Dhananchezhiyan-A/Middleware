"use client";

import { MoreHorizontal, Pencil, Route, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import { conditionLabel, normalizeConditions } from "@/lib/rule-condition";
import type { RoutingRule } from "@/lib/types";

export interface RoutingRulesTableProps {
  rows: RoutingRule[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** UX-only gating — the API enforces routing:write server-side. */
  canWrite: boolean;
  onToggle: (rule: RoutingRule, enabled: boolean) => void;
  onEdit: (rule: RoutingRule) => void;
  onDelete: (rule: RoutingRule) => void;
}

const CONDITION_PREVIEW = 3;

export function RoutingRulesTable({
  rows,
  isLoading,
  error,
  onRetry,
  canWrite,
  onToggle,
  onEdit,
  onDelete,
}: RoutingRulesTableProps) {
  if (isLoading) return <TableSkeleton rows={5} cols={7} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No routing rules yet"
        description="Routing rules decide which destinations receive a lead. Without one, leads are not delivered."
        icon={<Route className="size-5" />}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[80px] text-right">Priority</TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Conditions</TableHead>
          <TableHead>Destinations</TableHead>
          <TableHead className="w-[80px] text-right">Version</TableHead>
          <TableHead className="w-[90px]">Enabled</TableHead>
          <TableHead className="w-[150px]">Updated</TableHead>
          <TableHead className="w-[48px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((rule) => {
          const conditions = normalizeConditions(rule.conditions);
          const shown = conditions.slice(0, CONDITION_PREVIEW);
          const hidden = conditions.length - shown.length;
          return (
            <TableRow key={rule.id}>
              <TableCell className="text-right tabular-nums font-medium">
                {formatNumber(rule.priority)}
              </TableCell>
              <TableCell className="max-w-[240px]">
                <p className="truncate font-medium">{rule.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {rule.description || "—"}
                </p>
              </TableCell>
              <TableCell className="max-w-[320px]">
                <div className="flex flex-wrap gap-1">
                  {shown.map((condition, index) => (
                    <Badge key={`${rule.id}-${index}`} variant="outline" className="font-mono">
                      {conditionLabel(condition)}
                    </Badge>
                  ))}
                  {hidden > 0 ? <Badge variant="secondary">+{hidden} more</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="max-w-[220px]">
                <div className="flex flex-wrap gap-1">
                  {rule.destinations.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    rule.destinations.map((destination) => (
                      <Badge key={destination.id} variant="secondary">
                        {destination.name}
                      </Badge>
                    ))
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                {formatNumber(rule.version)}
              </TableCell>
              <TableCell>
                <Switch
                  checked={rule.enabled}
                  disabled={!canWrite}
                  onCheckedChange={(next) => onToggle(rule, next)}
                  ariaLabel={`Enable ${rule.name}`}
                />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(rule.updatedAt)}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${rule.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{rule.name}</DropdownMenuLabel>
                    {canWrite ? (
                      <>
                        <DropdownMenuItem onSelect={() => onEdit(rule)}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => onDelete(rule)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <DropdownMenuItem disabled>Edit</DropdownMenuItem>
                    )}
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
