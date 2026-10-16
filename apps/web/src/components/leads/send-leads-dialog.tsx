"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
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
import { useDestinations } from "@/lib/queries/integrations";
import { useManualSend, useSendPreview, type ManualSendPayload } from "@/lib/queries/leads";
import { sendPayload, type LeadSelectionState } from "@/lib/selection";
import { formatNumber } from "@/lib/format";
import type { ManualSendPreview, ManualSendResult } from "@/lib/types";

export interface SendLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: LeadSelectionState;
  /** Human summary of the active filters (shown in the confirmation). */
  filterChips: string[];
  onSent: (result: ManualSendResult) => void;
}

function selectedLeadCount(state: LeadSelectionState): number {
  return state.mode === "filtered" ? (state.filteredCount ?? 0) : state.ids.length;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium">{value}</span>
    </div>
  );
}

/**
 * Two-step manual delivery flow: pick ACTIVE destinations, review the
 * authoritative preview (counts revalidated server-side), confirm explicitly.
 * Nothing is delivered on open or on selection — only the final Send does.
 */
export function SendLeadsDialog({
  open,
  onOpenChange,
  state,
  filterChips,
  onSent,
}: SendLeadsDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"destinations" | "confirm">("destinations");
  const [destinationIds, setDestinationIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ManualSendPreview | null>(null);

  const destinations = useDestinations();
  const previewMutation = useSendPreview();
  const sendMutation = useManualSend();

  const leadCount = selectedLeadCount(state);
  const payload: ManualSendPayload | null = useMemo(() => {
    const base = sendPayload(state);
    return base ? { ...base, destinationIds } : null;
  }, [state, destinationIds]);

  // Reset when the dialog is reopened.
  useEffect(() => {
    if (open) {
      setStep("destinations");
      setPreview(null);
      previewMutation.reset();
      sendMutation.reset();
    }
  }, [open]);

  // Authoritative counts as soon as the confirm step is shown.
  useEffect(() => {
    if (step !== "confirm" || !open || !payload) return;
    previewMutation.mutate(payload, {
      onSuccess: setPreview,
      onError: (err) => toast({ title: "Could not preview the send", description: errorMessage(err), variant: "error" }),
    });
  }, [step, open, destinationIds]);

  const rows = destinations.data ?? [];
  const activeRows = rows.filter((d) => d.status === "ACTIVE");
  const inactiveSelected = destinationIds.some(
    (id) => rows.find((d) => d.id === id)?.status !== "ACTIVE",
  );

  const toggleDestination = (id: string) => {
    setDestinationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSend = async () => {
    if (!payload) return;
    try {
      const result = await sendMutation.mutateAsync(payload);
      onSent(result);
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not send the leads", description: errorMessage(err), variant: "error" });
    }
  };

  const combinations = preview?.combinations ?? leadCount * destinationIds.length;
  const skipped = preview ? preview.skippedExisting + preview.skippedMissingLeads : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "destinations" ? "Select destinations" : "Confirm manual delivery"}
          </DialogTitle>
          <DialogDescription>
            {step === "destinations"
              ? "Choose the CRMs this selection should be delivered to. Only active destinations can receive leads."
              : "Review exactly what will be queued. Real lead data will be sent to external systems."}
          </DialogDescription>
        </DialogHeader>

        {step === "destinations" ? (
          <>
            <p className="text-xs text-muted-foreground">
              {formatNumber(leadCount)} lead{leadCount === 1 ? "" : "s"} selected ·{" "}
              {formatNumber(activeRows.length)} active destination
              {activeRows.length === 1 ? "" : "s"} available
            </p>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {destinations.isLoading ? (
                <p className="p-2 text-xs text-muted-foreground">Loading destinations…</p>
              ) : rows.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">No destinations configured.</p>
              ) : (
                rows.map((destination) => {
                  const eligible = destination.status === "ACTIVE";
                  const checked = destinationIds.includes(destination.id);
                  return (
                    <label
                      key={destination.id}
                      className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${
                        eligible ? "cursor-pointer hover:bg-accent" : "opacity-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={checked}
                        disabled={!eligible}
                        onChange={() => toggleDestination(destination.id)}
                      />
                      <span className="flex-1 truncate">{destination.name}</span>
                      <Badge variant="outline">{destination.type}</Badge>
                      <Badge variant={eligible ? "success" : "secondary"}>
                        {destination.status}
                      </Badge>
                    </label>
                  );
                })
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => setStep("confirm")}
                disabled={destinationIds.length === 0 || inactiveSelected}
              >
                Review ({destinationIds.length} destination{destinationIds.length === 1 ? "" : "s"})
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-1 rounded-md border border-border p-3">
              <Row
                label="Selection"
                value={state.mode === "filtered" ? "All filtered leads (all pages)" : "Current page (explicit IDs)"}
              />
              <Row label="Selected leads" value={formatNumber(leadCount)} />
              <Row
                label="Destinations"
                value={
                  <span className="flex flex-wrap justify-end gap-1">
                    {preview && preview.destinations.length > 0
                      ? preview.destinations.map((d) => (
                          <Badge key={d.id} variant="outline">
                            {d.name}
                          </Badge>
                        ))
                      : destinationIds.map((id) => (
                          <Badge key={id} variant="outline">
                            {id}
                          </Badge>
                        ))}
                  </span>
                }
              />
              <Row
                label="Applied filters"
                value={
                  filterChips.length > 0 ? (
                    <span className="flex flex-wrap justify-end gap-1">
                      {filterChips.map((chip) => (
                        <Badge key={chip} variant="secondary">
                          {chip}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    "None"
                  )
                }
              />
              <Row
                label="Eligible lead × destination combinations"
                value={
                  preview ? (
                    formatNumber(preview.eligible)
                  ) : (
                    <span className="text-muted-foreground">Calculating…</span>
                  )
                }
              />
              {skipped !== null && skipped > 0 ? (
                <Row
                  label="Skipped (already delivered/queued or no longer exists)"
                  value={formatNumber(skipped)}
                />
              ) : null}
              <Row
                label="Total combinations requested"
                value={
                  preview ? (
                    `${formatNumber(preview.combinations)} (${formatNumber(leadCount)} × ${formatNumber(destinationIds.length)})`
                  ) : (
                    `${formatNumber(combinations)} (${formatNumber(leadCount)} × ${formatNumber(destinationIds.length)})`
                  )
                }
              />
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <p>
                This will send real lead data to {destinationIds.length} external CRM
                {destinationIds.length === 1 ? "" : "s"}. Deliveries are queued and processed in the
                background through the standard delivery pipeline.
              </p>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("destinations")} disabled={sendMutation.isPending}>
                Back
              </Button>
              <Button
                onClick={handleSend}
                disabled={!payload || previewMutation.isPending || sendMutation.isPending || preview === null}
              >
                {sendMutation.isPending
                  ? "Queuing…"
                  : `Send ${formatNumber(combinations)} deliver${combinations === 1 ? "y" : "ies"}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
