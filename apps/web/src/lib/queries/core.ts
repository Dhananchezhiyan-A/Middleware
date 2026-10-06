import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
import type {
  DashboardResult,
  DestinationPerformanceRow,
  HealthResult,
  PipelineFunnel,
  SourcePerformanceRow,
  TimeseriesPoint,
  TimeseriesSeries,
} from "@/lib/types";
import type { AnalyticsOverview } from "@/lib/types";

/** "2026-09-30T00:00:00.000Z" (or Date) → "2026-09-30" using UTC calendar days. */
function dayKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

interface RawTimeseries {
  days: number;
  leads: { day: string | Date; leads: number }[];
  deliveries: { day: string | Date; total: number; succeeded: number }[];
}

function toPoints(rows: { day: string | Date; count: number }[]): TimeseriesPoint[] {
  return rows.map((row) => ({ date: dayKey(row.day), count: row.count }));
}

/**
 * Dashboard dataset — composed from the five documented analytics routes.
 * There is no aggregate "dashboard" endpoint, so we fan out and combine
 * real responses rather than inventing a summary the API does not expose.
 */
export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: async (): Promise<DashboardResult> => {
      const [overview, rawSeries, sources, destinations, pipeline] = await Promise.all([
        api.get<AnalyticsOverview>("/analytics/overview"),
        api.get<RawTimeseries>("/analytics/timeseries", { query: { days: 30 } }),
        api.get<SourcePerformanceRow[]>("/analytics/sources"),
        api.get<DestinationPerformanceRow[]>("/analytics/destinations"),
        api.get<PipelineFunnel>("/analytics/pipeline"),
      ]);

      const series: TimeseriesSeries = {
        days: rawSeries.days,
        leads: toPoints(rawSeries.leads.map((row) => ({ day: row.day, count: row.leads }))),
        deliveries: toPoints(
          rawSeries.deliveries.map((row) => ({ day: row.day, count: row.succeeded })),
        ),
      };

      return { overview, series, sources, destinations, pipeline };
    },
  });
}

/** GET /health — public endpoint, no auth header required. */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.get<HealthResult>("/health", { auth: false, retryOn401: false }),
    retry: 1,
  });
}
