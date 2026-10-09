"use client";

import { CircleCheck, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, truncate } from "@/lib/format";
import { useDestinations } from "@/lib/queries/integrations";
import { useRoutingRules } from "@/lib/queries/automation";
import { routingFallbackInfo } from "@/lib/routing-fallback";
import type { LeadDelivery, RoutingResult } from "@/lib/types";

export interface LeadRoutingProps {
  results: RoutingResult[];
  /** Deliveries of the same lead — matched against `RoutingResult.destinationIds`. */
  deliveries: LeadDelivery[];
}

const STATUS_TONE: Record<string, string> = {
  SUCCEEDED: "border-emerald-500/50 text-emerald-500",
  FAILED: "border-red-500/50 text-red-500",
  DEAD: "border-red-500/50 text-red-500",
  PENDING: "border-amber-500/50 text-amber-500",
  QUEUED: "border-amber-500/50 text-amber-500",
  IN_PROGRESS: "border-amber-500/50 text-amber-500",
};

/**
 * Routing tab of the lead detail: which rule matched, which destinations were
 * selected, and the delivery status each one ended up with.
 *
 * FALLBACK IS INTERNAL: when no valid external destination exists the lead
 * stays inside Middleware ("Fallback: Internal Middleware"). No delivery row is
 * shown for it — there was never an outbound attempt.
 */
export function LeadRouting({ results, deliveries }: LeadRoutingProps) {
  const rules = useRoutingRules();
  const destinations = useDestinations();

  if (results.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No routing results"
          description="Routing runs after scoring; results appear once rules have been evaluated for this lead."
        />
      </Card>
    );
  }

  const ruleName = (ruleId?: string | null): string | null =>
    (rules.data ?? []).find((rule) => rule.id === ruleId)?.name ?? null;

  const destinationName = (destinationId: string): string => {
    const delivery = deliveries.find((row) => row.destination.id === destinationId);
    if (delivery) return delivery.destination.name;
    return (destinations.data ?? []).find((row) => row.id === destinationId)?.name ?? destinationId;
  };

  const deliveryFor = (destinationId: string): LeadDelivery | undefined =>
    deliveries.find((row) => row.destination.id === destinationId);

  return (
    <div className="space-y-3">
      {results.map((result) => {
        const reason = result.reason ?? "";
        const fallback = routingFallbackInfo(reason);

        return (
          <Card key={result.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Route className="size-4" />
                  {ruleName(result.ruleId) ?? (result.matched ? "Matched rule" : "No rule matched")}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={result.matched ? "success" : "secondary"}>
                    {result.matched ? "MATCHED" : "NO MATCH"}
                  </Badge>
                  {fallback.active ? (
                    <Badge variant="outline" className="border-amber-500/50 text-amber-500">
                      KEPT IN MIDDLEWARE
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(result.evaluatedAt)}
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {fallback.active ? (
                <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{fallback.title}</p>
                    <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                      {fallback.heading}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {fallback.description}
                    </p>
                  </div>
                </div>
              ) : null}

              <p className="break-words text-xs text-muted-foreground">
                {reason ? truncate(reason, 300) : "—"}
              </p>

              {result.destinationIds && result.destinationIds.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Destination</TableHead>
                      <TableHead className="w-[140px]">Delivery status</TableHead>
                      <TableHead className="w-[160px]">Attempts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.destinationIds.map((destinationId) => {
                      const delivery = deliveryFor(destinationId);
                      return (
                        <TableRow key={destinationId}>
                          <TableCell className="font-medium">
                            {destinationName(destinationId)}
                          </TableCell>
                          <TableCell>
                            {delivery ? (
                              <Badge
                                variant="outline"
                                className={STATUS_TONE[delivery.status] ?? undefined}
                              >
                                {delivery.status}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">no delivery</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-muted-foreground">
                            {delivery
                              ? `${delivery.attemptCount} / ${delivery.maxAttempts}`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  {fallback.active
                    ? "No external destination — nothing was sent anywhere. The lead remains in Middleware."
                    : "No destination selected — this lead was not delivered anywhere."}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
