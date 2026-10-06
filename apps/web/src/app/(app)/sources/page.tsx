"use client";

import { useState } from "react";
import { Plus, RefreshCw, Webhook } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SourceAccountsDialog } from "@/components/sources/source-accounts-dialog";
import { SourceDialog } from "@/components/sources/source-dialog";
import { SourcesTable } from "@/components/sources/sources-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useDeleteSource, useSources } from "@/lib/queries/integrations";
import type { SourceItem } from "@/lib/types";

/**
 * Sources — inbound lead channels.
 *
 * Deleting is blocked by the API while leads/accounts are attached, so the
 * error surfaces as a toast with the server's message (no client-side guess).
 */
export default function SourcesPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const sources = useSources();
  const remove = useDeleteSource();
  const canWrite = can("sources:write");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SourceItem | null>(null);
  const [accountsFor, setAccountsFor] = useState<SourceItem | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SourceItem | null>(null);

  const rows = sources.data ?? [];

  const openAccounts = (source: SourceItem) => {
    setAccountsFor(source);
    setAccountsOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      toast({ title: "Source deleted", description: pendingDelete.name, variant: "success" });
    } catch (err) {
      toast({ title: "Could not delete source", description: errorMessage(err), variant: "error" });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Sources"
        description="Inbound channels that produce leads — webhooks, APIs, ad platforms and files."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sources.refetch()}
              disabled={sources.isFetching}
            >
              <RefreshCw className={sources.isFetching ? "animate-spin" : undefined} />
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
                <Plus /> New source
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 text-xs text-muted-foreground">
        {sources.data ? `${formatNumber(rows.length)} sources loaded` : "Loading…"}
      </div>

      <Card>
        <SourcesTable
          rows={rows}
          isLoading={sources.isLoading}
          error={sources.error}
          onRetry={() => void sources.refetch()}
          canWrite={canWrite}
          onAccounts={openAccounts}
          onEdit={(source) => {
            setEditing(source);
            setDialogOpen(true);
          }}
          onDelete={setPendingDelete}
        />
      </Card>

      <SourceDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditing(null);
        }}
        source={editing}
      />

      <SourceAccountsDialog open={accountsOpen} onOpenChange={setAccountsOpen} source={accountsFor} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="Delete source?"
        description={
          <>
            <Webhook className="mr-1 inline size-3.5 align-[-2px]" />
            <span className="align-middle">
              {pendingDelete ? pendingDelete.name : ""} and its accounts are removed. The API
              refuses while leads are still attached.
            </span>
          </>
        }
        confirmLabel="Delete source"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
