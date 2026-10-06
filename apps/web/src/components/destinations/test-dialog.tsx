"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { EMPTY, formatDuration } from "@/lib/format";
import { useTestDestination } from "@/lib/queries/integrations";
import type { DestinationItem, DestinationTestResult } from "@/lib/types";

export interface TestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination: DestinationItem | null;
}

/**
 * Real connectivity probe — POST /destinations/:id/test runs the adapter's
 * network call with the stored credential. There is no simulated success.
 */
export function TestDialog({ open, onOpenChange, destination }: TestDialogProps) {
  const { toast } = useToast();
  const test = useTestDestination();
  const [result, setResult] = useState<DestinationTestResult | null>(null);

  useEffect(() => {
    if (!open || !destination) return;
    setResult(null);
    test.mutate(destination.id, {
      onSuccess: setResult,
      onError: (err) =>
        toast({ title: "Connection test failed", description: errorMessage(err), variant: "error" }),
    });
    // Run once per opening: deps intentionally limited to `open` + destination
    // (the mutation objects are stable per render and would only churn).
  }, [open, destination?.id]);

  const busy = test.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Test connection</DialogTitle>
          <DialogDescription>
            {destination?.name ?? ""} · {destination?.type ?? ""}
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="h-16 rounded-lg" />
            <p className="text-center text-[11px] text-muted-foreground">
              Running a real network probe…
            </p>
          </div>
        ) : result ? (
          <div className="space-y-3">
            <div
              className={
                result.ok
                  ? "flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2"
                  : "flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2"
              }
            >
              {result.ok ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="size-4 shrink-0 text-destructive" />
              )}
              <span className="text-xs font-medium">
                {result.ok ? "Connected" : "Connection failed"}
              </span>
              <Badge variant="outline" className="ml-auto">
                {String(result.status ?? EMPTY)}
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">Latency</dt>
              <dd className="text-right tabular-nums">
                {formatDuration(result.latencyMs ?? null)}
              </dd>
              {result.error ? (
                <>
                  <dt className="text-muted-foreground">Error</dt>
                  <dd className="break-words text-right text-destructive">{result.error}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={busy || !destination}
            onClick={() => destination && test.mutate(destination.id, {
              onSuccess: setResult,
              onError: (err) =>
                toast({ title: "Connection test failed", description: errorMessage(err), variant: "error" }),
            })}
          >
            {busy ? "Probing…" : "Run again"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
