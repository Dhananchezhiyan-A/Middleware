"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";
import { usePathname } from "next/navigation";
import { ActiveFilter } from "@/components/active-filter";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMPTY, formatDateTime, formatNumber } from "@/lib/format";
import { useWebhookEvents } from "@/lib/queries/integrations";
import { rangeFilterLabel, shortDate, type ListFilterParams } from "@/lib/range";
import Link from "next/link";

export interface WebhookEventsViewProps {
  /** Filters from the URL — the dashboard card opens this with `?range=24h`. */
  initialFilters?: ListFilterParams;
}

/**
 * Inbound webhook event log (GET /webhooks/events) with the drill-down filter
 * surfaced as an "Active Filter" banner.
 */
export function WebhookEventsView({ initialFilters }: WebhookEventsViewProps) {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  const events = useWebhookEvents({
    from: initialFilters?.from,
    to: initialFilters?.to,
    status: initialFilters?.status,
  });

  const items = events.data?.items ?? [];

  const chips: string[] = [];
  if (initialFilters?.range) chips.push(rangeFilterLabel(initialFilters.range));
  else if (initialFilters?.from) chips.push(`Received after: ${shortDate(initialFilters.from)}`);
  if (initialFilters?.status) chips.push(`Status: ${initialFilters.status}`);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Webhook Events"
        description="Every inbound webhook the platform received — status, duplicates, errors and the lead it produced."
      />

      {chips.length > 0 && !dismissed ? (
        <ActiveFilter
          chips={chips}
          clearHref={pathname}
          onClear={() => setDismissed(true)}
        />
      ) : null}

      <Card>
        {events.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : events.error ? (
          <div className="p-4">
            <ErrorState error={events.error} onRetry={() => void events.refetch()} />
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No webhook events"
              description="Inbound webhook events will appear here as soon as sources start receiving traffic."
              icon={<Inbox className="size-4" />}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source account</TableHead>
                <TableHead>External event</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(event.receivedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        event.status === "FAILED"
                          ? "border-red-500/50 text-red-500"
                          : event.status === "PROCESSED"
                            ? "border-emerald-500/50 text-emerald-500"
                            : undefined
                      }
                    >
                      {event.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{event.sourceAccountId}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-xs">
                    {event.externalEventId ?? EMPTY}
                  </TableCell>
                  <TableCell className="text-xs">
                    {event.leadId ? (
                      <Link
                        href={`/leads/${event.leadId}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        view lead
                      </Link>
                    ) : (
                      EMPTY
                    )}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
                    {event.error ?? EMPTY}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {events.data ? `Showing ${formatNumber(items.length)} of the most recent events.` : ""}
      </p>
    </div>
  );
}
