"use client";

import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CredentialsDialog } from "@/components/destinations/credentials-dialog";
import { DestinationDialog } from "@/components/destinations/destination-dialog";
import {
  DestinationsTable,
  type DestinationAction,
} from "@/components/destinations/destinations-table";
import { TestDialog } from "@/components/destinations/test-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useDeleteDestination, useDestinations, useUpdateDestination } from "@/lib/queries/integrations";
import type { DestinationItem } from "@/lib/types";

/**
 * Destinations — outbound delivery endpoints with real health probes.
 *
 * Health pills come from DestinationHealth rows written by actual adapter
 * probes; NOT_CONFIGURED simply means no probe has run yet (never faked green).
 */
export default function DestinationsPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const destinations = useDestinations();
  const remove = useDeleteDestination();
  const toggle = useUpdateDestination();

  const canWrite = can("destinations:write");
  const canTest = can("destinations:test");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DestinationItem | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<DestinationItem | null>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [testing, setTesting] = useState<DestinationItem | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DestinationItem | null>(null);
  const [pendingToggle, setPendingToggle] = useState<DestinationItem | null>(null);

  const rows = destinations.data ?? [];

  const runAction = (action: DestinationAction, destination: DestinationItem) => {
    switch (action) {
      case "test":
        setTesting(destination);
        setTestOpen(true);
        break;
      case "credentials":
        setCredentialsFor(destination);
        setCredentialsOpen(true);
        break;
      case "edit":
        setEditing(destination);
        break;
      case "toggle":
        setPendingToggle(destination);
        break;
      case "delete":
        setPendingDelete(destination);
        break;
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      toast({ title: "Destination deleted", description: pendingDelete.name, variant: "success" });
    } catch (err) {
      toast({ title: "Could not delete destination", description: errorMessage(err), variant: "error" });
    } finally {
      setPendingDelete(null);
    }
  };

  const confirmToggle = async () => {
    if (!pendingToggle) return;
    const next = pendingToggle.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      await toggle.mutateAsync({ id: pendingToggle.id, status: next });
      toast({ title: `Destination ${next === "ACTIVE" ? "enabled" : "disabled"}`, variant: "success" });
    } catch (err) {
      toast({ title: "Could not update destination", description: errorMessage(err), variant: "error" });
    } finally {
      setPendingToggle(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Destinations"
        description="Where routed leads are delivered. Health reflects real adapter probes — never a synthetic value."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void destinations.refetch()}
              disabled={destinations.isFetching}
            >
              <RefreshCw className={destinations.isFetching ? "animate-spin" : undefined} />
              Refresh
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus /> New destination
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 text-xs text-muted-foreground">
        {destinations.data ? `${formatNumber(rows.length)} destinations loaded` : "Loading…"}
      </div>

      <Card>
        <DestinationsTable
          rows={rows}
          isLoading={destinations.isLoading}
          error={destinations.error}
          onRetry={() => void destinations.refetch()}
          canWrite={canWrite}
          canTest={canTest}
          onAction={runAction}
        />
      </Card>

      <DestinationDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        destination={editing}
      />

      <DestinationDialog open={createOpen} onOpenChange={setCreateOpen} destination={null} />

      <CredentialsDialog
        open={credentialsOpen}
        onOpenChange={(next) => {
          setCredentialsOpen(next);
          if (!next) setCredentialsFor(null);
        }}
        destination={credentialsFor}
      />

      <TestDialog
        open={testOpen}
        onOpenChange={(next) => {
          setTestOpen(next);
          if (!next) setTesting(null);
        }}
        destination={testing}
      />

      <ConfirmDialog
        open={pendingToggle !== null}
        onOpenChange={(next) => {
          if (!next) setPendingToggle(null);
        }}
        title={pendingToggle?.status === "ACTIVE" ? "Disable destination?" : "Enable destination?"}
        description={
          pendingToggle?.status === "ACTIVE"
            ? "New deliveries will not be sent to this destination while it is disabled."
            : "Deliveries routed here resume as soon as the destination is enabled."
        }
        confirmLabel={pendingToggle?.status === "ACTIVE" ? "Disable" : "Enable"}
        danger={pendingToggle?.status === "ACTIVE"}
        loading={toggle.isPending}
        onConfirm={confirmToggle}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="Delete destination?"
        description="The API refuses while deliveries or routing rules still reference it — disable it instead."
        confirmLabel="Delete destination"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
