"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueueStats } from "@/lib/queries/delivery";
import type { QueueStats } from "@/lib/types";

type Counts = Record<string, number>;

function isCounts(value: unknown): value is Counts {
  return typeof value === "object" && value !== null && !("error" in (value as object));
}

function QueueCard({ name, counts }: { name: string; counts: Counts }) {
  const entries = Object.entries(counts);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-xs font-medium">{name}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-2">
              <dt className="text-[11px] text-muted-foreground">{key}</dt>
              <dd
                className={
                  (key === "failed" || key === "dead") && value > 0
                    ? "text-xs font-semibold tabular-nums text-destructive"
                    : "text-xs font-semibold tabular-nums"
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function QueueErrorCard({ name, error }: { name: string; error: string }) {
  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 font-mono text-xs font-medium">
          <AlertTriangle className="size-3.5 text-destructive" />
          {name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Verbatim server error — never rendered as zeros. */}
        <p className="break-words text-xs text-destructive">{error}</p>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  entries,
}: {
  title: string;
  entries: [string, QueueStats["queues"][string]][];
}) {
  if (entries.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {entries.map(([name, value]) =>
          isCounts(value) ? (
            <QueueCard key={name} name={name} counts={value} />
          ) : (
            <QueueErrorCard key={name} name={name} error={value.error} />
          ),
        )}
      </div>
    </section>
  );
}

/** /delivery/queue — live BullMQ counts (auto-refresh every 30s). */
export function QueueStatsView() {
  const stats = useQueueStats();

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Queue"
        description="Live BullMQ + Redis counts for every pipeline queue — refreshed automatically every 30s."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void stats.refetch()}
            disabled={stats.isFetching}
          >
            <RefreshCw className={stats.isFetching ? "animate-spin" : undefined} />
            Refresh
          </Button>
        }
      />

      {stats.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : stats.error ? (
        <Card>
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        </Card>
      ) : stats.data ? (
        <>
          <Section title="Queues" entries={Object.entries(stats.data.queues)} />
          <Section title="Dead letters" entries={Object.entries(stats.data.deadLetters)} />
        </>
      ) : null}
    </div>
  );
}
