"use client";

import { useState } from "react";
import { Plus, RefreshCw, Route } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { RoutingRuleDialog } from "@/components/automation/routing-rule-dialog";
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
import type { RoutingRule } from "@/lib/types";

/**
 * Routing rules — evaluated in ascending priority order; the first rule whose
 * conditions all match routes the lead to its destinations.
 */
export default function RoutingRulesPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const rules = useRoutingRules();
  const toggle = useSetRoutingRuleEnabled();
  const remove = useDeleteRoutingRule();
  const canWrite = can("routing:write");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoutingRule | null>(null);
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

      <Card>
        <RoutingRulesTable
          rows={rows}
          isLoading={rules.isLoading}
          error={rules.error}
          onRetry={() => void rules.refetch()}
          canWrite={canWrite}
          onToggle={handleToggle}
          onEdit={(rule) => {
            setEditing(rule);
            setDialogOpen(true);
          }}
          onDelete={setPendingDelete}
        />
      </Card>

      <RoutingRuleDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditing(null);
        }}
        rule={editing}
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
