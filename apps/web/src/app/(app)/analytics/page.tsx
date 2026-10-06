"use client";

import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
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

/**
 * Analytics — wider view over the same analytics routes the dashboard uses
 * (no synthetic numbers: every value comes from the API response).
 */
export default function AnalyticsPage() {
  const dashboard = useDashboard();
  const queue = useQueueStats();
  const { data, isLoading, error, refetch, isFetching } = dashboard;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Analytics"
        description="Thirty-day throughput, delivery reliability and per-endpoint performance."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        </div>
      ) : null}

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : null}

      {data ? (
        <div className="space-y-4">
          <DeliverySummaryCard delivery={data.overview.deliveries} />

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardContent className="p-4">
                <TimeseriesChart
                  points={data.series.leads}
                  height={220}
                  label="Leads received (rolling 30 days)"
                />
              </CardContent>
            </Card>
            <PipelineCard pipeline={data.pipeline} />
          </div>

          <Card>
            <CardContent className="p-4">
              <TimeseriesChart
                points={data.series.deliveries}
                height={180}
                label="Successful deliveries per day (rolling 30 days)"
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <DestinationPerformanceTable rows={data.destinations} />
            </div>
            <QueueHealthCard stats={queue.data} />
          </div>

          <SourcePerformanceTable rows={data.sources} />
        </div>
      ) : null}
    </div>
  );
}
