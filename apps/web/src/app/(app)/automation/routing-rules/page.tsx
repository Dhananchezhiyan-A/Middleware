"use client";

import { useState } from "react";
import { CircleCheck, Plus, RefreshCw, Route } from "lucide-react";
import { ROUTING_FALLBACK_LABEL } from "@middleware/types";
import { PageHeader } from "@/components/page-header";
import { RoutingRuleDialog } from "@/components/automation/routing-rule-dialog";
import { RoutingPreviewDialog } from "@/components/automation/routing-preview";
import { RoutingRulesTable } from "@/components/automation/routing-rules-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import {
  useDeleteRoutingRule,
  useRoutingRules,
  useSetRoutingRuleEnabled,
} from "@/lib/queries/automation";
import { useSources } from "@/lib/queries/integrations";
import type { RoutingRule } from "@/lib/types";

/**
 * Routing rules — evaluated in ascending priority order; the rule's match mode
 * decides whether every clause (ALL) or any one (ANY) must match.
 *
 * When no rule matches — or every selected destination is disabled — the lead
 * is kept by the INTERNAL Middleware fallback. "Middleware" is this
 * application, so there is no destination record to configure here.
 */
export default function RoutingRulesPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const rules = useRoutingRules();
  const sources = useSources();
  const toggle = useSetRoutingRuleEnabled();
  const remove = useDeleteRoutingRule();
  const canWrite = can("routing:write");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoutingRule | null>(null);
  const [duplicating, setDuplicating] = useState<RoutingRule | null>(null);
  const [testing, setTesting] = useState<RoutingRule | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoutingRule | null>(null);

  const rows = rules.data ?? [];

  const handleToggle = async (rule: RoutingRule, enabled: boolean) => {
    try {
      await toggle.mutateAsync({ id: rule.id, enabled });
      toast({
        title: enabled ? "Rule enabled" : "Rule disabled",
        description: rule.name,
        variant: "success",
      });
    } catch (err) {
      toast({ title: "Could not update rule", description: errorMessage(err), variant: "error" });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      toast({ title: "Routing rule deleted", description: pendingDelete.name, variant: "success" });
    } catch (err) {
      toast({ title: "Could not delete rule", description: errorMessage(err), variant: "error" });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Routing Rules"
        description="Conditions decide which destinations receive a lead. Rules are evaluated in ascending priority order."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void rules.refetch()}
              disabled={rules.isFetching}
            >
              <RefreshCw className={rules.isFetching ? "animate-spin" : undefined} />
              Refresh
            </Button>
            {canWrite ? (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDuplicating(null);
                  setDialogOpen(true);
                }}
              >
                <Plus /> New rule
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 text-xs text-muted-foreground">
        {rules.data ? `${formatNumber(rows.length)} rules loaded` : "Loading…"}
        {!canWrite ? " · read-only (routing:write)" : ""}
      </div>

      {/* --- Internal fallback (kept in Middleware, never a destination) --- */}
      <Card className="mb-3 flex items-start gap-3 border-primary/40 bg-primary/5 p-4">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            Fallback:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {ROUTING_FALLBACK_LABEL}
            </code>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When no rule matches — or every destination a matched rule selects is
            disabled — the lead stays in Middleware. Nothing is queued and nothing is sent
            anywhere: the fallback is internal, so it has no destination record.
          </p>
        </div>
      </Card>

      <Card>
        <RoutingRulesTable
          rows={rows}
          isLoading={rules.isLoading}
          error={rules.error}
          onRetry={() => void rules.refetch()}
          canWrite={canWrite}
          sources={sources.data ?? []}
          onToggle={handleToggle}
          onEdit={(rule) => {
            setEditing(rule);
            setDuplicating(null);
            setDialogOpen(true);
          }}
          onDuplicate={(rule) => {
            setEditing(null);
            setDuplicating(rule);
            setDialogOpen(true);
          }}
          onTest={setTesting}
          onDelete={setPendingDelete}
        />
      </Card>

      <RoutingRuleDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) {
            setEditing(null);
            setDuplicating(null);
          }
        }}
        rule={editing ?? duplicating}
        duplicate={duplicating !== null}
      />

      <RoutingPreviewDialog
        open={testing !== null}
        onOpenChange={(next) => {
          if (!next) setTesting(null);
        }}
        rule={testing}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="Delete routing rule?"
        description={
          <>
            <Route className="mr-1 inline size-3.5 align-[-2px]" />
            <span className="align-middle">
              {pendingDelete ? pendingDelete.name : ""} is removed permanently. Leads that would
              have matched it are no longer routed by it.
            </span>
          </>
        }
        confirmLabel="Delete rule"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
