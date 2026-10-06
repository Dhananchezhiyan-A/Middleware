"use client";

import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyableValue, CopyButton } from "@/components/ui/copy-button";
import { useToast } from "@/components/ui/toast";

export interface SecretOnceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  secret: string;
  /** Caption above the secret (defaults to the source-signing wording). */
  label?: string;
  /** Optional secondary value (e.g. the webhook URL) shown under the secret. */
  secondary?: { label: string; value: string };
}

/**
 * One-time secret reveal.
 *
 * Secrets are write-only: the API returns them exactly once (creation or
 * rotation) and never again, so this dialog has no "show later" affordance —
 * only copy + acknowledge.
 */
export function SecretOnceDialog({
  open,
  onOpenChange,
  title,
  secret,
  label = "Signing secret",
  secondary,
}: SecretOnceDialogProps) {
  const { toast } = useToast();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            This value is shown once. Store it in your secret manager now — the API will never
            return it again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <p className="text-[11px] leading-relaxed text-amber-500">
              Save this secret now. It will not be shown again.
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{secret}</code>
              <CopyButton
                value={secret}
                label="Copy Secret"
                onCopied={() =>
                  toast({
                    title: "Signing secret copied",
                    description: "It is on your clipboard and will not be shown again.",
                    variant: "success",
                  })
                }
              />
            </div>
          </div>

          {secondary ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">{secondary.label}</p>
              <CopyableValue value={secondary.value} />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            <Check /> I stored it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
