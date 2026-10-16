"use client";

import Link from "next/link";
import { Inbox, X } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDeliveryStats } from "@/lib/queries/leads";
import type { DeliveryStats, ManualSendResult } from "@/lib/types";

export interface DeliveryProgressProps {
  result: ManualSendResult;
  onDismiss: () => void;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className={`text-lg font-semibold ${tone ?? ""}`}>{formatNumber(value)}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Live results of one manual-send submission. Queued jobs and real successes
 * are reported separately (a queued delivery is NOT a success), polled from
 * GET /deliveries/stats every 2s while the submission is still moving.
 */
export function DeliveryProgress({ result, onDismiss }: DeliveryProgressProps) {
  // Poll every 2s while PENDING/QUEUED/IN_PROGRESS deliveries remain, then
  // stop — an idle panel never polls.
  const stats = useDeliveryStats(result.submissionId, (query) => {
    const data = (query as { state?: { data?: DeliveryStats } }).state?.data;
    const by = data?.byStatus ?? {};
    const moving = (by["PENDING"] ?? 0) + (by["QUEUED"] ?? 0) + (by["IN_PROGRESS"] ?? 0) > 0;
    return moving ? 2000 : false;
  });
  const by = stats.data?.byStatus ?? {};
  const queued = (by["PENDING"] ?? 0) + (by["QUEUED"] ?? 0);
  const processing = by["IN_PROGRESS"] ?? 0;
  const succeeded = by["SUCCEEDED"] ?? 0;
  const failed = (by["FAILED"] ?? 0) + (by["DEAD"] ?? 0);
  const active = queued + processing > 0;

  return (
    <div className="mb-3 rounded-md border border-border bg-secondary/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Manual delivery — results</p>
        <Badge variant={active ? "secondary" : "success"}>
          {stats.isFetching && active ? "Processing…" : active ? "In progress" : "Completed"}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          Submission {result.submissionId.slice(0, 8)} · started {new Date(result.createdAt).toLocaleString()}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/delivery/queue">
              <Inbox /> View delivery queue
            </Link>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss results">
            <X />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Leads selected" value={result.leadCount} />
        <Stat label="Destinations" value={result.destinations.length} />
        <Stat label="Combinations requested" value={result.combinations} />
        <Stat label="Queued (waiting)" value={queued} />
        <Stat label="Processing" value={processing} />
        <Stat label="Succeeded" value={succeeded} tone="text-emerald-500" />
        <Stat label="Failed" value={failed} tone={failed > 0 ? "text-destructive" : undefined} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Newly queued by this submission: <span className="font-medium text-foreground">{formatNumber(result.created)}</span>
        </span>
        <span>
          Skipped (already delivered/queued or gone):{" "}
          <span className="font-medium text-foreground">{formatNumber(result.skipped)}</span>
          {result.skippedExisting > 0 ? ` (${formatNumber(result.skippedExisting)} existing)` : ""}
          {result.skippedMissingLeads > 0 ? ` (${formatNumber(result.skippedMissingLeads)} missing)` : ""}
        </span>
        {result.failed > 0 ? (
          <span className="text-amber-400">
            Rejected by field mapping (no external call):{" "}
            <span className="font-medium">{formatNumber(result.failed)}</span>
          </span>
        ) : null}
        {result.enqueueFailures > 0 ? (
          <span className="text-amber-400">
            {formatNumber(result.enqueueFailures)} row(s) await re-enqueue by the worker sweeper.
          </span>
        ) : null}
      </div>

      {stats.data && stats.data.destinations.length > 0 ? (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {stats.data.destinations.map((destination) => {
            const d = destination.byStatus ?? {};
            return (
              <div key={destination.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge variant="outline">{destination.name}</Badge>
                <span className="text-muted-foreground">
                  queued {formatNumber((d["PENDING"] ?? 0) + (d["QUEUED"] ?? 0))} · processing{" "}
                  {formatNumber(d["IN_PROGRESS"] ?? 0)} · succeeded {formatNumber(d["SUCCEEDED"] ?? 0)}{" "}
                  · failed {formatNumber((d["FAILED"] ?? 0) + (d["DEAD"] ?? 0))}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
