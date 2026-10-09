"use client";

import { useState } from "react";
import type { DeliveryStatus } from "@middleware/types";
import { usePathname } from "next/navigation";
import { ActiveFilter } from "@/components/active-filter";
import { PageHeader } from "@/components/page-header";
import { DeliveryTable } from "@/components/delivery/delivery-table";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { deliveryRows, useDeliveryList, useReplayDelivery } from "@/lib/queries/delivery";
import { rangeFilterLabel, shortDate, type ListFilterParams } from "@/lib/range";
import type { DeliveryListItem } from "@/lib/types";

export interface DeliveryViewProps {
  title: string;
  description?: string;
  /** Fixed status filter applied by preset pages (Successful/Failed). */
  presetStatus?: DeliveryStatus;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Filters carried over from a dashboard drill-down (`?range=`, `?status=`, …). */
  initialFilters?: ListFilterParams;
}

/**
 * Shared deliveries list: cursor-paginated table with replay actions.
 * Mirrors LeadsView so every delivery page behaves identically.
 */
export function DeliveryView({
  title,
  description,
  presetStatus,
  emptyTitle,
  emptyDescription,
  initialFilters,
}: DeliveryViewProps) {
  const pathname = usePathname();
  const { toast } = useToast();
  const [filterDismissed, setFilterDismissed] = useState(false);

  const status = presetStatus ?? (initialFilters?.status as DeliveryStatus | undefined);
  const params = {
    status,
    from: initialFilters?.from,
    to: initialFilters?.to,
  };

  const deliveries = useDeliveryList(params);
  const replay = useReplayDelivery();

  const rows = deliveryRows(deliveries.data);

  const onReplay = async (delivery: DeliveryListItem) => {
    try {
      await replay.mutateAsync(delivery.id);
      toast({
        title: "Replay queued",
        description: `New attempt cycle for ${delivery.destination.name}`,
        variant: "success",
      });
    } catch (err) {
      toast({ title: "Could not replay delivery", description: errorMessage(err), variant: "error" });
    }
  };

  const chips: string[] = [];
  if (initialFilters) {
    if (initialFilters.range) chips.push(rangeFilterLabel(initialFilters.range));
    else if (initialFilters.from) chips.push(`Updated after: ${shortDate(initialFilters.from)}`);
    if (initialFilters.status) chips.push(`Status: ${initialFilters.status}`);
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={title}
        description={
          description ??
          (deliveries.data
            ? `${formatNumber(rows.length)} deliveries loaded · cursor pagination, server-side status filter.`
            : "Loading…")
        }
      />

      {chips.length > 0 && !filterDismissed ? (
        <ActiveFilter chips={chips} clearHref={pathname} onClear={() => setFilterDismissed(true)} />
      ) : null}

      <Card>
        <DeliveryTable
          rows={rows}
          isLoading={deliveries.isLoading}
          error={deliveries.error}
          onRetry={() => void deliveries.refetch()}
          hasNextPage={Boolean(deliveries.hasNextPage)}
          isFetchingNextPage={deliveries.isFetchingNextPage}
          onLoadMore={() => void deliveries.fetchNextPage()}
          canReplay
          onReplay={(delivery) => void onReplay(delivery)}
          replayPending={replay.isPending}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
        />
      </Card>
    </div>
  );
}
