"use client";

import { useState } from "react";
import { Eye, Plus, Power, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ScoringDialog } from "@/components/automation/scoring-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useCreateScoring, useScoring, useToggleScoring } from "@/lib/queries/automation";
import type { ScoringRuleSet } from "@/lib/types";

function conditionText(rule: ScoringRuleSet["rules"][number]): string {
  const { field, operator, value } = rule.condition;
  if (value === null || value === undefined) return `${field} ${operator}`;
  const rendered = Array.isArray(value) ? value.join(", ") : String(value);
  return `${field} ${operator} ${rendered}`;
}

function RulesDialog({
  ruleSet,
  onOpenChange,
}: {
  ruleSet: ScoringRuleSet | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={ruleSet !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {ruleSet ? `${ruleSet.name} · ${ruleSet.version}` : "Rules"}
          </DialogTitle>
        </DialogHeader>
        {ruleSet ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {ruleSet.rules.map((rule) => (
              <li key={rule.id} className="flex items-start gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{rule.label}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {conditionText(rule)}
                  </p>
                </span>
                <Badge variant={rule.points >= 0 ? "success" : "danger"}>
                  {rule.points >= 0 ? "+" : ""}
                  {rule.points} pts
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function ScoringPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const scoring = useScoring();
  const create = useCreateScoring();
  const toggle = useToggleScoring();
  const canWrite = can("scoring:write");

  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<ScoringRuleSet | null>(null);

  const rows = scoring.data ?? [];
  const active = rows.find((row) => row.enabled) ?? null;

  const onToggle = async (ruleSet: ScoringRuleSet) => {
    try {
      await toggle.mutateAsync({ id: ruleSet.id, enabled: !ruleSet.enabled });
      toast({
        title: ruleSet.enabled ? "Rule set disabled" : "Rule set enabled",
        description: ruleSet.name,
        variant: "success",
      });
    } catch (err) {
      toast({ title: "Could not update rule set", description: errorMessage(err), variant: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Scoring"
        description="Named rule sets that add points to every lead. Rule sets are immutable after creation — enable exactly one at a time."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void scoring.refetch()}
              disabled={scoring.isFetching}
            >
              <RefreshCw className={scoring.isFetching ? "animate-spin" : undefined} />
              Refresh
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={() => setCreateOpen(true)} disabled={create.isPending}>
                <Plus /> New rule set
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        {scoring.isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : scoring.error ? (
          <ErrorState error={scoring.error} onRetry={() => void scoring.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No scoring rule sets"
            description="Create a rule set to score leads on fields like company size or budget — the score then feeds routing decisions."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule set</TableHead>
                <TableHead className="w-[90px]\">Version</TableHead>
                <TableHead className="w-[110px]\">Status</TableHead>
                <TableHead className="w-[90px] text-right\">Rules</TableHead>
                <TableHead className="w-[160px]">{active ? "Enabled since" : "Created"}</TableHead>
                <TableHead className="w-[90px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((ruleSet) => (
                <TableRow key={ruleSet.id}>
                  <TableCell>
                    <p className="truncate font-medium">{ruleSet.name}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ruleSet.version}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={ruleSet.enabled ? "success" : "secondary"}>
                      {ruleSet.enabled ? "ENABLED" : "DISABLED"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(ruleSet.rules.length)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(ruleSet.activatedAt ?? ruleSet.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`View rules for ${ruleSet.name}`}
                      onClick={() => setViewing(ruleSet)}
                    >
                      <Eye />
                    </Button>
                    {canWrite ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={ruleSet.enabled ? "Disable rule set" : "Enable rule set"}
                        disabled={toggle.isPending}
                        onClick={() => void onToggle(ruleSet)}
                      >
                        <Power />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ScoringDialog open={createOpen} onOpenChange={setCreateOpen} />
      <RulesDialog ruleSet={viewing} onOpenChange={(next) => (!next ? setViewing(null) : undefined)} />
    </div>
  );
}
