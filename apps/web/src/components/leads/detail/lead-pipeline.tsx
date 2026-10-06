"use client";

import { Check, Circle, Loader, Minus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonViewer } from "@/components/ui/json-viewer";
import { EmptyState } from "@/components/ui/states";
import { EMPTY, formatDateTime, formatDuration } from "@/lib/format";
import { stageStatusVariant } from "@/lib/status";
import type { StageEvent, StageStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function StatusIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case "PASSED":
      return <Check className="size-3.5" />;
    case "FAILED":
      return <X className="size-3.5" />;
    case "RUNNING":
      return <Loader className="size-3.5 animate-spin" />;
    case "SKIPPED":
      return <Minus className="size-3.5" />;
    default:
      return <Circle className="size-3.5" />;
  }
}

function statusClasses(status: StageStatus): string {
  switch (status) {
    case "PASSED":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "FAILED":
      return "border-red-500/40 bg-red-500/10 text-red-500";
    case "RUNNING":
      return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

/** Vertical pipeline stepper built from the lead's stage events. */
export function LeadPipeline({ events }: { events: StageEvent[] }) {
  if (events.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No stage events recorded"
          description="Stage events appear once the worker starts processing this lead."
        />
      </Card>
    );
  }

  const ordered = [...events].sort((a, b) => {
    const aTime = a.startedAt ? Date.parse(a.startedAt) : Number.MAX_SAFE_INTEGER;
    const bTime = b.startedAt ? Date.parse(b.startedAt) : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative ml-1 space-y-4 border-l border-border pl-5">
          {ordered.map((event) => (
            <li key={event.id} className="relative">
              <span
                className={cn(
                  "absolute -left-[30px] flex size-6 items-center justify-center rounded-full border",
                  statusClasses(event.status),
                )}
              >
                <StatusIcon status={event.status} />
              </span>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{event.stage}</span>
                <Badge variant={stageStatusVariant(event.status)}>{event.status}</Badge>
                {event.durationMs !== null && event.durationMs !== undefined ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatDuration(event.durationMs)}
                  </span>
                ) : null}
              </div>

              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {event.startedAt ? formatDateTime(event.startedAt) : EMPTY}
                {event.finishedAt ? ` → ${formatDateTime(event.finishedAt)}` : ""}
              </p>

              {event.error ? (
                <p className="mt-1.5 break-words rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  {event.error}
                </p>
              ) : null}

              {event.detail ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
                    Detail
                  </summary>
                  <JsonViewer value={event.detail} maxHeight="14rem" className="mt-1.5" />
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
