"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldEditor, emptyRow, rowsToFields, type FieldRow } from "@/components/automation/field-editor";
import { FieldLabel } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { useCreateFieldMapping } from "@/lib/queries/automation";
import { useDestinations } from "@/lib/queries/integrations";

export interface FieldMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Create a field mapping: destination + name + source → target pairs. */
export function FieldMappingDialog({ open, onOpenChange }: FieldMappingDialogProps) {
  const { toast } = useToast();
  const destinations = useDestinations();
  const create = useCreateFieldMapping();

  const [destinationId, setDestinationId] = useState("");
  const [name, setName] = useState("");
  const [rows, setRows] = useState<FieldRow[]>([emptyRow()]);
  const [notes, setNotes] = useState("");
  const [activate, setActivate] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDestinationId("");
    setName("");
    setRows([emptyRow()]);
    setNotes("");
    setActivate(true);
    setFormError(null);
  }, [open]);

  const submit = async () => {
    if (!destinationId) {
      setFormError("Pick a destination.");
      return;
    }
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    const { fields, error } = rowsToFields(rows);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    try {
      await create.mutateAsync({
        destinationId,
        name: name.trim(),
        fields,
        notes: notes.trim() || undefined,
        activate,
      });
      toast({ title: "Field mapping created", description: name.trim(), variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not create mapping", description: errorMessage(err), variant: "error" });
    }
  };

  const busy = create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New field mapping</DialogTitle>
          <DialogDescription>
            Reshapes lead fields for one destination. Versions are immutable — every save appends a
            new version you can activate or roll back to.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel label="Destination" required />
              <Select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
                <option value="">Select a destination…</option>
                {(destinations.data ?? []).map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name} ({destination.type})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Name" required />
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CRM payload v1"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel label="Fields" required hint="source → target pairs" />
            <FieldEditor rows={rows} onChange={setRows} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel label="Notes" hint="why this version exists" />
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="optional"
              />
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

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create mapping"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
