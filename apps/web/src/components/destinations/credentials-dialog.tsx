"use client";

import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { credentialOptions, typeInfo } from "@/lib/destination-config";
import {
  useDestinationDetail,
  useRemoveDestinationCredential,
  useSetDestinationCredentials,
} from "@/lib/queries/integrations";
import type { DestinationItem } from "@/lib/types";

export interface CredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination: DestinationItem | null;
}

/**
 * Write-only credential form.
 *
 * The API stores secrets AES-256-GCM encrypted and never returns them, so this
 * dialog can only show METADATA (type + rotation time) from GET /destinations/:id.
 */
export function CredentialsDialog({ open, onOpenChange, destination }: CredentialsDialogProps) {
  const { toast } = useToast();
  const id = destination?.id ?? null;
  const detail = useDestinationDetail(id, open);
  const setCredential = useSetDestinationCredentials();
  const removeCredential = useRemoveDestinationCredential();

  const [type, setType] = useState("BEARER");
  const [secret, setSecret] = useState("");
  const [metaText, setMetaText] = useState("{}");
  const [metaError, setMetaError] = useState<string | null>(null);

  const options = credentialOptions(destination?.type);
  const info = typeInfo(destination?.type);

  useEffect(() => {
    if (!open) return;
    setSecret("");
    setMetaText("{}");
    setMetaError(null);
    setType(options[0] ?? "BEARER");
  }, [open, options]);

  const parseMeta = (): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(metaText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setMetaError("Metadata must be a JSON object.");
        return null;
      }
      setMetaError(null);
      return parsed as Record<string, unknown>;
    } catch {
      setMetaError("Invalid JSON.");
      return null;
    }
  };

  const submit = async () => {
    if (!id) return;
    const meta = parseMeta();
    if (!meta) return;
    try {
      await setCredential.mutateAsync({ id, type, secret, meta });
      toast({ title: "Credential stored", description: "Encrypted at rest — never returned.", variant: "success" });
      setSecret("");
      await detail.refetch();
    } catch (err) {
      toast({ title: "Could not store credential", description: errorMessage(err), variant: "error" });
    }
  };

  const clear = async () => {
    if (!id) return;
    try {
      await removeCredential.mutateAsync(id);
      toast({ title: "Credential removed", variant: "success" });
      await detail.refetch();
    } catch (err) {
      toast({ title: "Could not remove credential", description: errorMessage(err), variant: "error" });
    }
  };

  const credential = detail.data?.credential ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Credentials — {destination?.name ?? ""}</DialogTitle>
          <DialogDescription>
            Secrets are write-only: accepted here, encrypted with AES-256-GCM, and never returned by
            the API — not even to this screen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
          <div className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">
            {credential ? (
              <>
                Stored credential: <span className="font-medium text-foreground">{credential.type}</span>
                {credential.rotatedAt ? ` · rotated ${formatDateTime(credential.rotatedAt)}` : ""}
                {credential.createdAt ? ` · created ${formatDateTime(credential.createdAt)}` : ""}
              </>
            ) : detail.isLoading ? (
              "Loading credential metadata…"
            ) : (
              <>
                No credential stored yet
                {info ? ` · adapter accepts ${info.credentialTypes.join(" / ")}` : ""}
                {info?.credentialRequired ? " (required for delivery)" : " (optional)"}
              </>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel label="Credential type" required />
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel label="Secret" required hint="write-only" />
            <Input
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="••••••••••••"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldLabel label="Metadata (JSON)" hint="non-secret: key id, token endpoint…" />
          <Textarea
            rows={3}
            className="font-mono text-xs"
            value={metaText}
            onChange={(event) => setMetaText(event.target.value)}
          />
          {metaError ? <p className="text-[11px] text-destructive">{metaError}</p> : null}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={!credential || removeCredential.isPending}
            onClick={() => void clear()}
          >
            <KeyRound /> Remove stored secret
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={() => void submit()} disabled={setCredential.isPending || !secret}>
              {setCredential.isPending ? "Storing…" : "Store secret"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
