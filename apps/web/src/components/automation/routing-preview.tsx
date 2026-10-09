"use client";

import { useState } from "react";
import { CircleCheck, CircleX, Route, X } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { errorMessage } from "@/lib/api";
import { useSources } from "@/lib/queries/integrations";
import { usePreviewRouting, type RoutingPreviewBody } from "@/lib/queries/automation";
import { cn } from "@/lib/utils";
import type { RoutingPreview, RoutingRule } from "@/lib/types";

export interface RoutingPreviewResultProps {
  preview?: RoutingPreview;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** One "label: value" line of the routing decision summary. */
function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  );
}

function ClauseChip({ label, matched }: { label: string; matched: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
        matched
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-500"
          : "border-red-500/40 bg-red-500/10 text-red-500",
      )}
      title={label}
    >
      {matched ? <CircleCheck className="size-3 shrink-0" /> : <CircleX className="size-3 shrink-0" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * Result of POST /routing-rules/preview — the same engine the pipeline runs,
 * evaluated against a sample lead without persisting anything.
 */
export function RoutingPreviewResult({
  preview,
  isLoading,
  error,
  onRetry,
}: RoutingPreviewResultProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3">
        <p className="text-xs font-medium text-red-500">Preview failed</p>
        <p className="mt-1 break-words text-[11px] text-muted-foreground">{errorMessage(error)}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (!preview) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        Run a preview to see exactly which rules match and where the lead would go.
      </p>
    );
  }

  const destinations = preview.destinations;
  const fallback = preview.fallback;
  const keptInMiddleware = Boolean(fallback);
  const matchedCount = preview.rules.filter((rule) => rule.matched).length;
  const hasExternalRoute = destinations.length > 0;

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-md border p-3",
          hasExternalRoute
            ? "border-emerald-500/50 bg-emerald-500/10"
            : keptInMiddleware
              ? "border-amber-500/50 bg-amber-500/10"
              : "border-border bg-background/40",
        )}
      >
        <div className="flex items-start gap-2">
          <Route className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {hasExternalRoute
                ? `${matchedCount} rule(s) matched → ${destinations.length} destination(s)`
                : preview.matched
                  ? "Rule matched — no valid external destination"
                  : "No rule matched"}
            </p>
            <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{preview.reason}</p>

            {hasExternalRoute ? (
              <p className="mt-2 text-xs">
                <span className="text-muted-foreground">Would create </span>
                <span className="font-semibold tabular-nums">{preview.deliveryCount}</span>
                <span className="text-muted-foreground"> external delivery record(s) → </span>
                {destinations.map((destination) => destination.name).join(", ")}
              </p>
            ) : null}

            {/* "rule matched" is NOT "deliverable": the three facts stay apart. */}
            <div className="mt-2 space-y-0.5 text-[11px]">
              <SummaryRow
                label="Matched rules"
                value={preview.matched ? String(matchedCount) : "0"}
              />
              <SummaryRow
                label="Valid external destinations"
                value={String(preview.validDestinationCount)}
              />
              <SummaryRow
                label="External deliveries"
                value={String(preview.deliveryCount)}
                tone={preview.deliveryCount > 0 ? "text-emerald-500" : undefined}
              />
              <SummaryRow
                label="Fallback"
                value={fallback ? "Internal Middleware" : "none"}
                tone={fallback ? "text-amber-500" : undefined}
              />
            </div>

            <p className="mt-1 text-[11px] text-muted-foreground">
              Evaluated at {formatDateTime(preview.receivedAt)} · timezone {preview.timezone}
              {keptInMiddleware ? " · the lead stays in Middleware (no outbound request)" : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {preview.rules.map((rule) => (
          <div
            key={rule.id}
            className={cn(
              "rounded-md border p-2",
              rule.matched
                ? "border-emerald-500/40"
                : rule.skipped
                  ? "border-border opacity-70"
                  : "border-border",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">{rule.name}</span>
              <span className="text-[11px] text-muted-foreground">priority {rule.priority}</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  rule.matched
                    ? "bg-emerald-500/15 text-emerald-500"
                    : rule.skipped
                      ? "bg-muted text-muted-foreground"
                      : "bg-red-500/15 text-red-500",
                )}
              >
                {rule.matched ? "Matched" : rule.skipped ? "Skipped" : "No match"}
              </span>
              {rule.clauses.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">no conditions</span>
              ) : null}
            </div>
            {rule.clauses.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {rule.clauses.map((clause) => (
                  <ClauseChip key={clause.key} label={clause.label} matched={clause.matched} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface RoutingPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stored rule to dry-run against a sample lead. */
  rule: RoutingRule | null;
}

/**
 * "Test rule" dialog: pick a source and a couple of lead values, run the
 * preview endpoint and read the decision. Nothing is written or delivered.
 */
export function RoutingPreviewDialog({ open, onOpenChange, rule }: RoutingPreviewDialogProps) {
  const [email, setEmail] = useState("");
  const [score, setScore] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [ran, setRan] = useState(false);
  const sources = useSources();
  const preview = usePreviewRouting();

  const run = async () => {
    if (!rule) return;
    const body: RoutingPreviewBody = {
      ruleIds: [rule.id],
      receivedAt: new Date().toISOString(),
      ...(sourceId ? { sourceId } : {}),
      ...(score.trim() !== "" && !Number.isNaN(Number(score)) ? { score: Number(score) } : {}),
      ...(email.trim() ? { canonical: { email: email.trim() } } : {}),
    };
    setRan(true);
    await preview.mutateAsync(body).catch(() => undefined);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRan(false);
          preview.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Test routing — {rule?.name ?? ""}</DialogTitle>
          <DialogDescription>
            Dry-run only: nothing is stored, queued or delivered.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <FieldLabel label="Source" />
            <Select
              aria-label="Preview source"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value="">Any source</option>
              {(sources.data ?? []).map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel label="Email" hint="sample lead" />
            <Input
              aria-label="Preview email"
              placeholder="lead@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel label="Score" />
            <Input
              aria-label="Preview score"
              type="number"
              placeholder="70"
              value={score}
              onChange={(event) => setScore(event.target.value)}
            />
          </div>
        </div>

        <RoutingPreviewResult
          preview={ran ? preview.data : undefined}
          isLoading={preview.isPending}
          error={ran ? preview.error : null}
          onRetry={() => void run()}
        />

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <X /> Close
          </Button>
          <Button type="button" onClick={() => void run()} disabled={preview.isPending || !rule}>
            {preview.isPending ? "Running…" : ran ? "Run again" : "Run preview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
