"use client";

import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FieldMappingDialog } from "@/components/automation/field-mapping-dialog";
import { FieldMappingsTable } from "@/components/automation/field-mappings-table";
import { MappingVersionsDialog } from "@/components/automation/mapping-versions-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { useDeleteFieldMapping, useFieldMappings } from "@/lib/queries/automation";
import type { FieldMappingListItem } from "@/lib/types";

export default function FieldMappingsPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const mappings = useFieldMappings();
  const remove = useDeleteFieldMapping();
  const canWrite = can("mappings:write");

  const [createOpen, setCreateOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FieldMappingListItem | null>(null);

  const rows = mappings.data ?? [];

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      toast({ title: "Mapping deleted", description: pendingDelete.name, variant: "success" });
    } catch (err) {
      toast({ title: "Could not delete mapping", description: errorMessage(err), variant: "error" });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Field Mappings"
        description="Reshape lead fields per destination. Versions are immutable — activate one to roll back instantly."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void mappings.refetch()}
              disabled={mappings.isFetching}
            >
              <RefreshCw className={mappings.isFetching ? "animate-spin" : undefined} />
              Refresh
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus /> New mapping
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <FieldMappingsTable
          rows={rows}
          isLoading={mappings.isLoading}
          error={mappings.error}
          onRetry={() => void mappings.refetch()}
          canWrite={canWrite}
          onVersions={(mapping) => setViewingId(mapping.id)}
          onDelete={setPendingDelete}
        />
      </Card>

      <FieldMappingDialog open={createOpen} onOpenChange={setCreateOpen} />

      <MappingVersionsDialog
        open={viewingId !== null}
        onOpenChange={(next) => {
          if (!next) setViewingId(null);
        }}
        mappingId={viewingId}
        canWrite={canWrite}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="Delete mapping?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" and its version history are removed permanently. Deliveries already sent are unaffected.`
            : ""
        }
        confirmLabel="Delete mapping"
        danger
        loading={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
