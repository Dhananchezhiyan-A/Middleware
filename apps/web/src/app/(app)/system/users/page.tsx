"use client";

import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { UserDialog } from "@/components/system/user-dialog";
import { UsersTable } from "@/components/system/users-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useUsers, userRows } from "@/lib/queries/system";
import type { UserListItem } from "@/lib/types";

export default function SystemUsersPage() {
  const { can } = useAuth();
  const users = useUsers();
  const canWrite = can("users:write");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);

  const rows = userRows(users.data);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Users"
        description="People with a login to this application. Access comes from the assigned role."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void users.refetch()}
              disabled={users.isFetching}
            >
              <RefreshCw className={users.isFetching ? "animate-spin" : undefined} />
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
                <Plus /> New user
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 text-xs text-muted-foreground">
        {users.data ? `${formatNumber(rows.length)} users loaded` : "Loading…"}
      </div>

      <Card>
        <UsersTable
          rows={rows}
          isLoading={users.isLoading}
          error={users.error}
          onRetry={() => void users.refetch()}
          canWrite={canWrite}
          onEdit={(user) => {
            setEditing(user);
            setDialogOpen(true);
          }}
        />
      </Card>

      <UserDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditing(null);
        }}
        user={editing}
      />
    </div>
  );
}
