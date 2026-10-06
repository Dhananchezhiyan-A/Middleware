"use client";

import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { RoleDialog } from "@/components/system/role-dialog";
import { RolesTable } from "@/components/system/roles-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { useDeleteRole, useRoles } from "@/lib/queries/system";
import type { RoleListItem } from "@/lib/types";

export default function SystemRolesPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const roles = useRoles();
  const remove = useDeleteRole();
  const canWrite = can("roles:write");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoleListItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoleListItem | null>(null);

  const rows = roles.data ?? [];

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      toast({ title: "Role deleted", description: pendingDelete.name, variant: "success" });
    } catch (err) {
      toast({ title: "Could not delete role", description: errorMessage(err), variant: "error" });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Roles"
        description="Roles bundle permissions. System roles (admin, manager, developer, viewer) are protected by the API."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void roles.refetch()}
              disabled={roles.isFetching}
            >
              <RefreshCw className={roles.isFetching ? "animate-spin" : undefined} />
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
                <Plus /> New role
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <RolesTable
          rows={rows}
          isLoading={roles.isLoading}
          error={roles.error}
          onRetry={() => void roles.refetch()}
          canWrite={canWrite}
          onEdit={(role) => {
            setEditing(role);
            setDialogOpen(true);
          }}
          onDelete={setPendingDelete}
        />
      </Card>

      <RoleDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditing(null);
        }}
        role={editing}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="Delete role?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" is removed permanently. The API refuses while users still hold this role.`
            : ""
        }
        confirmLabel="Delete role"
        danger
        loading={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
