"use client";

import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  CalendarRange,
  CircleCheck,
  Loader,
  RefreshCw,
  Webhook,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import {
  DeliverySummaryCard,
  DestinationPerformanceTable,
  PipelineCard,
  QueueHealthCard,
  RoutingSummaryCard,
  SourcePerformanceTable,
} from "@/components/dashboard/performance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/lib/queries/core";
import { useQueueStats } from "@/lib/queries/delivery";

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
      <Skeleton className="h-56 rounded-lg" />
    </div>
  );
}

export default function DashboardPage() {
  const dashboard = useDashboard();
  const queue = useQueueStats();
  const { data, isLoading, error, refetch, isFetching } = dashboard;

  const overview = data?.overview;
  const byStatus = overview?.leads.byStatus ?? {};

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Dashboard"
        description="Live snapshot of lead intake, processing and delivery."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            Refresh
          </Button>
        }
      />

      {isLoading ? <DashboardSkeleton /> : null}

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : null}

      {data && overview ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Leads (24h)" value={overview.leads.total24h} icon={Calendar} href="/leads?range=24h" />
            <StatCard label="Leads (7d)" value={overview.leads.total7d} icon={CalendarDays} href="/leads?range=7d" />
            <StatCard label="Leads (30d)" value={overview.leads.total30d} icon={CalendarRange} href="/leads?range=30d" />
            <StatCard
              label="Inbound webhooks (24h)"
              value={overview.inbound.webhookEvents24h}
              icon={Webhook}
              href="/webhooks/events?range=24h"
            />
            <StatCard
              label="Processing"
              value={byStatus.PROCESSING ?? 0}
              icon={Loader}
              hint="In pipeline"
              href="/leads?status=PROCESSING"
            />
            <StatCard
              label="Processed"
              value={byStatus.PROCESSED ?? 0}
              icon={CircleCheck}
              tone="success"
              href="/leads?status=PROCESSED"
            />
            <StatCard
              label="Failed"
              value={byStatus.FAILED ?? 0}
              icon={AlertTriangle}
              tone="danger"
              href="/leads?status=FAILED"
            />
            <StatCard
              label="Rejected"
              value={byStatus.REJECTED ?? 0}
              icon={XCircle}
              tone="warning"
              hint="Validation / policy"
              href="/leads?status=REJECTED"
            />
          </div>

          <DeliverySummaryCard
            delivery={overview.deliveries}
            successHref="/analytics"
            attemptsHref="/delivery/successful"
          />

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2 transition-colors hover:border-primary/40">
              <Link href="/leads" className="block">
                <CardContent className="p-4">
                  <TimeseriesChart points={data.series.leads} />
                </CardContent>
              </Link>
            </Card>
            <QueueHealthCard stats={queue.data} href="/delivery/queue" />
          </div>

          <div className="grid gap-4 xl:grid-cols-4">
            <PipelineCard pipeline={data.pipeline} />
            <RoutingSummaryCard routing={overview.routing} />
            <div className="xl:col-span-2">
              <DestinationPerformanceTable rows={data.destinations} />
            </div>
          </div>

          <SourcePerformanceTable rows={data.sources} />
        </div>
      ) : null}
    </div>
  );
}
