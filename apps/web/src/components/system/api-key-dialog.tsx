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
import { FieldLabel } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { useCreateApiKey } from "@/lib/queries/system";
import type { ApiKeyCreated } from "@/lib/types";

export interface ApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires with the create response (carries the raw `apiKey`, shown once). */
  onCreated: (created: ApiKeyCreated) => void;
}

/**
 * Two plain fields with explicit validation — an empty expiry must mean
 * "never expires", which a number-input + zod combo turns into NaN.
 */
export function ApiKeyDialog({ open, onOpenChange, onCreated }: ApiKeyDialogProps) {
  const { toast } = useToast();
  const createKey = useCreateApiKey();

  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDays("");
    setFormError(null);
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Name is required.");
      return;
    }
    const body: { name: string; expiresInDays?: number } = { name: trimmed };
    if (days.trim()) {
      const value = Number(days);
      if (!Number.isInteger(value) || value < 1 || value > 3650) {
        setFormError("Expiry must be a whole number of days between 1 and 3650.");
        return;
      }
      body.expiresInDays = value;
    }
    setFormError(null);
    try {
      const created = await createKey.mutateAsync(body);
      onOpenChange(false);
      onCreated(created);
    } catch (err) {
      toast({ title: "Could not create API key", description: errorMessage(err), variant: "error" });
    }
  };

  const busy = createKey.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>
            The raw key is returned exactly once — copy it into your secret manager immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel label="Name" required hint="where the key will be used" />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="billing-sync-prod"
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel label="Expires in (days)" hint="optional — empty means never expires" />
            <Input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              placeholder="90"
            />
          </div>

          {formError ? <p className="text-[11px] text-destructive">{formError}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
