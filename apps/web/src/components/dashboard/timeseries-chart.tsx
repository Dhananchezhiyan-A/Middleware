import { EMPTY, formatNumber } from "@/lib/format";
import type { TimeseriesPoint } from "@/lib/types";

/**
 * Hand-rolled bar/area chart (no chart library).
 * Renders CSS bars — data comes exclusively from the API timeseries.
 */
export function TimeseriesChart({
  points,
  height = 168,
  label = "Leads per day",
}: {
  points: TimeseriesPoint[];
  height?: number;
  label?: string;
}) {
  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
        style={{ height }}
      >
        No timeseries data returned for this period.
      </div>
    );
  }

  const max = Math.max(...points.map((p) => p.count), 1);
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const first = points[0]?.date ?? EMPTY;
  const last = points[points.length - 1]?.date ?? EMPTY;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {formatNumber(total)} total · peak {formatNumber(max)} · {first} → {last}
        </span>
      </div>

      <div className="relative rounded-md border border-border bg-background/50 p-2">
        {/* Peak guide line */}
        <div
          className="pointer-events-none absolute inset-x-2 border-t border-dashed border-border/70"
          style={{ top: `calc(0.5rem + 0px)` }}
        />
        <div className="flex items-end gap-[2px]" style={{ height }}>
          {points.map((point) => {
            const pct = Math.max((point.count / max) * 100, point.count > 0 ? 3 : 0);
            return (
              <div
                key={point.date}
                className="group relative flex h-full flex-1 items-end"
                title={`${point.date}: ${formatNumber(point.count)}`}
              >
                <div
                  className="w-full rounded-t-[2px] bg-gradient-to-t from-indigo-600/70 to-indigo-400 transition-opacity group-hover:opacity-80"
                  style={{ height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}
