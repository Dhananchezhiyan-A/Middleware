"use client";

import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ApiKeyDialog } from "@/components/system/api-key-dialog";
import { ApiKeysTable } from "@/components/system/api-keys-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SecretOnceDialog } from "@/components/sources/secret-once-dialog";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { useApiKeys, useRevokeApiKey } from "@/lib/queries/system";
import type { ApiKeyCreated, ApiKeyListItem } from "@/lib/types";

export default function ApiKeysPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const canWrite = can("apikeys:write");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyListItem | null>(null);

  const rows = keys.data ?? [];

  const confirmRevoke = async () => {
    if (!pendingRevoke) return;
    try {
      await revoke.mutateAsync(pendingRevoke.id);
      toast({ title: "API key revoked", description: pendingRevoke.name, variant: "success" });
    } catch (err) {
      toast({ title: "Could not revoke key", description: errorMessage(err), variant: "error" });
    } finally {
      setPendingRevoke(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="API Keys"
        description="Machine credentials for the x-api-key header. Revocation is immediate and idempotent."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void keys.refetch()}
              disabled={keys.isFetching}
            >
              <RefreshCw className={keys.isFetching ? "animate-spin" : undefined} />
              Refresh
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus /> New key
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <ApiKeysTable
          rows={rows}
          isLoading={keys.isLoading}
          error={keys.error}
          onRetry={() => void keys.refetch()}
          canWrite={canWrite}
          onRevoke={setPendingRevoke}
        />
      </Card>

      <ApiKeyDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={setCreated} />

      <SecretOnceDialog
        open={created !== null}
        onOpenChange={(next) => {
          if (!next) setCreated(null);
        }}
        title="API key created"
        label="API key"
        secret={created?.apiKey ?? ""}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRevoke(null);
        }}
        title="Revoke API key?"
        description={
          pendingRevoke
            ? `"${pendingRevoke.name}" stops working immediately. This cannot be undone — issue a new key instead.`
            : ""
        }
        confirmLabel="Revoke key"
        danger
        loading={revoke.isPending}
        onConfirm={() => void confirmRevoke()}
      />
    </div>
  );
}
