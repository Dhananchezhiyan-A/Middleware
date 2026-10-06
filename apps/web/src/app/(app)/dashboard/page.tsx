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
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import {
  DeliverySummaryCard,
  DestinationPerformanceTable,
  PipelineCard,
  QueueHealthCard,
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
            <StatCard label="Leads (24h)" value={overview.leads.total24h} icon={Calendar} />
            <StatCard label="Leads (7d)" value={overview.leads.total7d} icon={CalendarDays} />
            <StatCard label="Leads (30d)" value={overview.leads.total30d} icon={CalendarRange} />
            <StatCard
              label="Inbound webhooks (24h)"
              value={overview.inbound.webhookEvents24h}
              icon={Webhook}
            />
            <StatCard label="Processing" value={byStatus.PROCESSING ?? 0} icon={Loader} hint="In pipeline" />
            <StatCard
              label="Processed"
              value={byStatus.PROCESSED ?? 0}
              icon={CircleCheck}
              tone="success"
            />
            <StatCard label="Failed" value={byStatus.FAILED ?? 0} icon={AlertTriangle} tone="danger" />
            <StatCard
              label="Rejected"
              value={byStatus.REJECTED ?? 0}
              icon={XCircle}
              tone="warning"
              hint="Validation / policy"
            />
          </div>

          <DeliverySummaryCard delivery={overview.deliveries} />

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardContent className="p-4">
                <TimeseriesChart points={data.series.leads} />
              </CardContent>
            </Card>
            <QueueHealthCard stats={queue.data} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <PipelineCard pipeline={data.pipeline} />
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
