"use client";

import type { DeliveryStatus } from "@middleware/types";
import { PageHeader } from "@/components/page-header";
import { DeliveryTable } from "@/components/delivery/delivery-table";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { deliveryRows, useDeliveryList, useReplayDelivery } from "@/lib/queries/delivery";
import type { DeliveryListItem } from "@/lib/types";

export interface DeliveryViewProps {
  title: string;
  description?: string;
  /** Fixed status filter applied by preset pages (Successful/Failed). */
  presetStatus?: DeliveryStatus;
  emptyTitle?: string;
  emptyDescription?: string;
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
}: DeliveryViewProps) {
  const { toast } = useToast();
  const deliveries = useDeliveryList({ status: presetStatus });
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
