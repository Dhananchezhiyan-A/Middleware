"use client";

import { Copy, MoreHorizontal, Pencil, Play, Route, Trash2 } from "lucide-react";
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
import {
  conditionLabel,
  constraintLabels,
  normalizeConditions,
  routingModeLabel,
  ruleSourceIds,
} from "@/lib/rule-condition";
import type { RoutingRule, SourceItem } from "@/lib/types";

export interface RoutingRulesTableProps {
  rows: RoutingRule[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** UX-only gating — the API enforces routing:write server-side. */
  canWrite: boolean;
  /** Resolves `conditions.sourceId` to a human name (empty list = show ids). */
  sources: SourceItem[];
  onToggle: (rule: RoutingRule, enabled: boolean) => void;
  onEdit: (rule: RoutingRule) => void;
  onDuplicate: (rule: RoutingRule) => void;
  onTest: (rule: RoutingRule) => void;
  onDelete: (rule: RoutingRule) => void;
}

const CONDITION_PREVIEW = 3;

export function RoutingRulesTable({
  rows,
  isLoading,
  error,
  onRetry,
  canWrite,
  sources,
  onToggle,
  onEdit,
  onDuplicate,
  onTest,
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

  const sourceName = (id?: string): string | undefined => {
    if (!id) return undefined;
    return sources.find((source) => source.id === id)?.name ?? id;
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[80px] text-right">Priority</TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Conditions</TableHead>
          <TableHead>Destinations</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Last matched</TableHead>
          <TableHead className="w-[80px] text-right">Version</TableHead>
          <TableHead className="w-[90px]">Enabled</TableHead>
          <TableHead className="w-[150px]">Updated</TableHead>
          <TableHead className="w-[48px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((rule) => {
          const conditions = normalizeConditions(rule.conditions);
          const constraints = constraintLabels(rule.conditions);
          const shown = conditions.slice(0, CONDITION_PREVIEW);
          const hidden = conditions.length - shown.length;
          const { sourceId } = ruleSourceIds(rule.conditions);
          const stop = rule.stopOnMatch;

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
              <TableCell className="max-w-[160px]">
                <div className="flex flex-wrap gap-1">
                  {sourceId ? (
                    <Badge variant="secondary" className="truncate">
                      {sourceName(sourceId)}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Any source</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="max-w-[320px]">
                <div className="flex flex-wrap gap-1">
                  {constraints.map((label) => (
                    <Badge key={label} variant="outline">
                      {label}
                    </Badge>
                  ))}
                  {shown.map((condition, index) => (
                    <Badge key={`${rule.id}-${index}`} variant="outline" className="font-mono">
                      {conditionLabel(condition)}
                    </Badge>
                  ))}
                  {hidden > 0 ? <Badge variant="secondary">+{hidden} more</Badge> : null}
                  {constraints.length === 0 && conditions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Matches everything</span>
                  ) : null}
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
              <TableCell>
                <Badge variant={stop ? "default" : "outline"} className="whitespace-nowrap">
                  {stop ? "Stop after first" : "Match all"}
                </Badge>
                <span className="sr-only">{routingModeLabel(rule)}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {rule.lastMatchedAt ? formatDateTime(rule.lastMatchedAt) : "Never"}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                {formatNumber(rule.version ?? 0)}
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
                    <DropdownMenuItem onSelect={() => onTest(rule)}>
                      <Play /> Test
                    </DropdownMenuItem>
                    {canWrite ? (
                      <>
                        <DropdownMenuItem onSelect={() => onEdit(rule)}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onDuplicate(rule)}>
                          <Copy /> Duplicate
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
