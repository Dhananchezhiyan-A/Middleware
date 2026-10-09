import { DeliveryView } from "@/components/delivery/delivery-view";
import { readListFilterParams, type SearchParamsValue } from "@/lib/range";
import { DeliveryStatuses } from "@middleware/types";

interface FailedDeliveriesPageProps {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}

export default async function FailedDeliveriesPage({ searchParams }: FailedDeliveriesPageProps) {
  const initialFilters = readListFilterParams(await searchParams, DeliveryStatuses);

  return (
    <DeliveryView
      title="Failed"
      description="Deliveries whose latest attempt failed but that can still be replayed (status: FAILED)."
      presetStatus="FAILED"
      emptyTitle="No failed deliveries"
      emptyDescription="A delivery lands here when an attempt fails and retries are still available. Use the replay action to start a fresh attempt cycle."
      initialFilters={initialFilters}
    />
  );
}
