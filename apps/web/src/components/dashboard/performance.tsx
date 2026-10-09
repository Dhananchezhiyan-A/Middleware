import { Activity, Boxes, CircleCheck, Inbox, Route } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EMPTY, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import type {
  AnalyticsOverview,
  DestinationPerformanceRow,
  PipelineFunnel,
  QueueStats,
  SourcePerformanceRow,
} from "@/lib/types";

/**
 * Optional drill-down wrapper: when `href` is given the card becomes a link
 * that carries the metric's filter to its detail page.
 */
function CardLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

function statusCell(counts: Partial<Record<string, number>> | undefined, key: string) {
  return <span className="tabular-nums">{formatNumber(counts?.[key] ?? 0)}</span>;
}

/** GET /analytics/pipeline — stage distribution as a proportional bar list. */
export function PipelineCard({ pipeline }: { pipeline: PipelineFunnel | undefined }) {
  const stages = pipeline?.stages ?? [];
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Pipeline funnel</CardTitle>
          <Badge variant="outline">{formatNumber(pipeline?.total ?? 0)} leads</Badge>
        </div>
        <CardDescription>Leads grouped by their current stage.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {stages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No leads in the pipeline yet.</p>
        ) : (
          stages.map((stage) => (
            <div key={stage.stage}>
              <div className="mb-1 flex items-baseline justify-between text-[11px]">
                <span className="truncate text-muted-foreground">{stage.stage}</span>
                <span className="tabular-nums text-foreground">
                  {formatNumber(stage.count)}{" "}
                  <span className="text-muted-foreground">({stage.share}%)</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${Math.max((stage.count / max) * 100, 2)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function SourcePerformanceTable({ rows }: { rows: SourcePerformanceRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source performance</CardTitle>
        <CardDescription>Lead volume grouped by inbound source and status.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 px-5 pb-5 text-xs text-muted-foreground">
            <Inbox className="size-4" /> No sources have produced leads yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="w-[130px]">Type</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Processed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.source.id}>
                  <TableCell className="font-medium">{row.source.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.source.type}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-500">
                    {statusCell(row.byStatus, "PROCESSED")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-red-500">
                    {statusCell(row.byStatus, "FAILED")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function DestinationPerformanceTable({ rows }: { rows: DestinationPerformanceRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Destination performance</CardTitle>
        <CardDescription>Delivery outcomes and latency per destination.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 px-5 pb-5 text-xs text-muted-foreground">
            <Inbox className="size-4" /> No destinations configured yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Deliveries</TableHead>
                <TableHead className="text-right">Succeeded</TableHead>
                <TableHead className="text-right">Success rate</TableHead>
                <TableHead className="text-right">Avg latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.destination.id}>
                  <TableCell>
                    <p className="font-medium">{row.destination.name}</p>
                    <Badge variant="outline" className="mt-0.5">
                      {row.destination.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-500">
                    {formatNumber(row.succeeded)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.successRate === null ? EMPTY : formatPercent(row.successRate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.avgLatencyMs === null ? EMPTY : formatDuration(row.avgLatencyMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Queue health — real BullMQ counts; a queue reporting an error shows it verbatim. */
export function QueueHealthCard({ stats, href }: { stats: QueueStats | undefined; href?: string }) {
  const entries = stats ? Object.entries(stats.queues) : [];
  const degraded = entries.filter(([, value]) => "error" in value);
  const dlqEntries = stats ? Object.entries(stats.deadLetters) : [];

  return (
    <CardLink href={href}>
      <Card className="h-full transition-colors group-hover:border-primary/45">
        <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Queue health</CardTitle>
          {!stats ? (
            <Badge variant="outline">LOADING</Badge>
          ) : degraded.length > 0 ? (
            <Badge variant="warning">DEGRADED</Badge>
          ) : (
            <Badge variant="success">HEALTHY</Badge>
          )}
        </div>
        <CardDescription>BullMQ + Redis delivery pipeline counters.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!stats ? (
          <p className="text-xs text-muted-foreground">Queue stats not loaded.</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No queues reported by the API.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {entries.map(([name, value]) =>
              "error" in value ? (
                <div
                  key={name}
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5"
                >
                  <p className="truncate text-xs font-medium text-destructive">{name}</p>
                  <p className="mt-1 break-words text-[11px] text-destructive">{value.error}</p>
                </div>
              ) : (
                <div key={name} className="rounded-md border border-border bg-background/50 p-2.5">
                  <p className="mb-1.5 truncate text-xs font-medium">{name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {Object.entries(value).map(([key, count]) => (
                      <span key={key} className="tabular-nums">
                        {key}: <span className="text-foreground">{formatNumber(count)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {dlqEntries.length > 0 ? (
          <div className="rounded-md border border-border bg-background/50 p-2.5">
            <p className="mb-1.5 text-xs font-medium">Dead letters</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {dlqEntries.map(([name, value]) => (
                <span key={name} className="tabular-nums">
                  {name}:{" "}
                  <span className="text-foreground">
                    {"error" in value ? value.error : formatNumber(value.waiting ?? 0)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
      </Card>
    </CardLink>
  );
}

/**
 * Delivery outcomes from GET /analytics/overview.
 * `successRate` is already a percentage (0–100) or null when nothing delivered.
 *
 * `successHref` / `attemptsHref` turn each metric into a drill-down link that
 * preserves the metric (delivery analytics / attempt details).
 */
export function DeliverySummaryCard({
  delivery,
  successHref,
  attemptsHref,
}: {
  delivery: AnalyticsOverview["deliveries"];
  successHref?: string;
  attemptsHref?: string;
}) {
  const rate = delivery?.successRate ?? null;
  const failed = delivery?.byStatus?.FAILED ?? 0;
  const dead = delivery?.byStatus?.DEAD ?? 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <CardLink href={successHref}>
        <Card className="h-full transition-colors group-hover:border-primary/45">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Delivery success rate</CardTitle>
              <CircleCheck className="size-4 text-emerald-500" />
            </div>
            <CardDescription>
              {delivery
                ? `${formatNumber(delivery.succeeded)} succeeded · ${formatNumber(failed)} failed · ${formatNumber(dead)} dead`
                : "Delivery metrics not returned."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {rate === null ? EMPTY : formatPercent(rate)}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${rate === null ? 0 : Math.min(rate, 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {delivery ? `${formatNumber(delivery.total)} deliveries in total` : "—"}
            </p>
          </CardContent>
        </Card>
      </CardLink>

      <CardLink href={attemptsHref}>
        <Card className="h-full transition-colors group-hover:border-primary/45">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Avg attempts to succeed</CardTitle>
              <Activity className="size-4 text-primary" />
            </div>
            <CardDescription>Delivery attempts consumed by successful deliveries.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {delivery?.avgAttemptsOnSuccess === null || delivery?.avgAttemptsOnSuccess === undefined
                ? EMPTY
                : formatNumber(delivery.avgAttemptsOnSuccess, 2)}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Boxes className="size-3.5" />
              <span>
                {delivery?.avgAttemptsOnSuccess === null ||
                delivery?.avgAttemptsOnSuccess === undefined
                  ? "No successful deliveries recorded."
                  : "attempts per successful delivery"}
              </span>
            </div>
          </CardContent>
        </Card>
      </CardLink>
    </div>
  );
}

/**
 * Routing analytics (GET /analytics/overview → `routing`): how many leads a
 * rule matched, how many matched nothing, and how many the INTERNAL fallback
 * kept inside Middleware (never an external delivery — success or failure).
 * Links through to the routing rules list.
 */
export function RoutingSummaryCard({ routing }: { routing?: AnalyticsOverview["routing"] }) {
  const entries: { label: string; value: number; hint: string }[] = [
    { label: "Matched rules", value: routing?.matchedRules ?? 0, hint: "routed by a rule" },
    { label: "Unmatched leads", value: routing?.unmatchedLeads ?? 0, hint: "no rule matched" },
    { label: "Kept in Middleware", value: routing?.fallbackLeads ?? 0, hint: "internal fallback" },
  ];

  return (
    <CardLink href="/automation/routing-rules">
      <Card className="h-full transition-colors group-hover:border-primary/45">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Routing</CardTitle>
            <Route className="size-4 text-primary" />
          </div>
          <CardDescription>Routing decisions recorded for processed leads.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">{entry.label}</span>
                <span className="text-lg font-semibold tabular-nums">{formatNumber(entry.value)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground/80">{entry.hint}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </CardLink>
  );
}
