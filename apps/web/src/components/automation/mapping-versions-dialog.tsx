"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FieldEditor,
  fieldsToRows,
  rowsToFields,
  type FieldRow,
} from "@/components/automation/field-editor";
import { FieldLabel } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  useActivateFieldMappingVersion,
  useCreateFieldMappingVersion,
  useFieldMapping,
} from "@/lib/queries/automation";
import type { FieldMappingVersion } from "@/lib/types";

export interface MappingVersionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mappingId: string | null;
  /** UX-only gate — the API enforces mappings:write server-side. */
  canWrite: boolean;
}

/**
 * Version history for one mapping + immutable version creation.
 * New versions are prefilled from the active version; activation is a
 * separate, explicit action (or the activate checkbox at creation).
 */
export function MappingVersionsDialog({
  open,
  onOpenChange,
  mappingId,
  canWrite,
}: MappingVersionsDialogProps) {
  const { toast } = useToast();
  const detail = useFieldMapping(mappingId ?? "");
  const createVersion = useCreateFieldMappingVersion();
  const activateVersion = useActivateFieldMappingVersion();

  const [mode, setMode] = useState<"list" | "create">("list");
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [notes, setNotes] = useState("");
  const [activate, setActivate] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("list");
    setNotes("");
    setActivate(true);
    setFormError(null);
  }, [open]);

  const startCreate = () => {
    const active = detail.data?.versions.find((v) => v.id === detail.data?.activeVersionId);
    setRows(fieldsToRows(active?.fields));
    setNotes("");
    setActivate(true);
    setFormError(null);
    setMode("create");
  };

  const submit = async () => {
    if (!mappingId) return;
    const { fields, error } = rowsToFields(rows);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    try {
      await createVersion.mutateAsync({
        id: mappingId,
        fields,
        notes: notes.trim() || undefined,
        activate,
      });
      toast({ title: "Version created", description: notes.trim() || "new version", variant: "success" });
      setMode("list");
    } catch (err) {
      toast({ title: "Could not create version", description: errorMessage(err), variant: "error" });
    }
  };

  const activateNow = async (version: FieldMappingVersion) => {
    if (!mappingId) return;
    try {
      await activateVersion.mutateAsync({ id: mappingId, version: version.version });
      toast({ title: "Version activated", description: `v${version.version}`, variant: "success" });
    } catch (err) {
      toast({ title: "Could not activate version", description: errorMessage(err), variant: "error" });
    }
  };

  const mapping = detail.data;
  const versions = [...(mapping?.versions ?? [])].sort((a, b) => b.version - a.version);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New version" : (mapping?.name ?? "Versions")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Appends an immutable version — the previous version stays intact for rollback."
              : "Every save appends a version. Only one version is active per mapping."}
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <Skeleton className="h-40" />
        ) : detail.error ? (
          <p className="text-xs text-destructive">{errorMessage(detail.error)}</p>
        ) : mode === "list" ? (
          <div className="space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border">
              {versions.map((version) => {
                const isActive = version.id === mapping?.activeVersionId;
                return (
                  <li key={version.id} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={isActive ? "success" : "secondary"}>v{version.version}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatNumber(version.fields.length)} fields
                        </span>
                        {isActive ? (
                          <span className="text-[11px] font-medium text-success">active</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {version.notes || "—"} · {formatDateTime(version.createdAt)}
                      </p>
                    </div>
                    {canWrite && !isActive ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={activateVersion.isPending}
                        onClick={() => void activateNow(version)}
                      >
                        Activate
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <FieldLabel label="Fields" required hint="prefilled from the active version" />
              <FieldEditor rows={rows} onChange={setRows} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel label="Notes" hint="what changed in this version" />
                <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={activate}
                  onChange={(event) => setActivate(event.target.checked)}
                />
                Activate immediately
              </label>
            </div>
            {formError ? <p className="text-[11px] text-destructive">{formError}</p> : null}
          </div>
        )}

        <DialogFooter>
          {mode === "create" ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setMode("list")}>
                <ArrowLeft /> Back
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={createVersion.isPending}>
                {createVersion.isPending ? "Saving…" : "Create version"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {canWrite ? (
                <Button type="button" onClick={startCreate}>
                  <Plus /> New version
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
