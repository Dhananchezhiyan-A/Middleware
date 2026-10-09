import { DeliveryView } from "@/components/delivery/delivery-view";
import { readListFilterParams, type SearchParamsValue } from "@/lib/range";
import { DeliveryStatuses } from "@middleware/types";

interface SuccessfulDeliveriesPageProps {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}

export default async function SuccessfulDeliveriesPage({
  searchParams,
}: SuccessfulDeliveriesPageProps) {
  const initialFilters = readListFilterParams(await searchParams, DeliveryStatuses);

  return (
    <DeliveryView
      title="Successful"
      description="Deliveries that reached the destination with a 2xx response (status: SUCCEEDED)."
      presetStatus="SUCCEEDED"
      emptyTitle="No successful deliveries yet"
      emptyDescription="Deliveries appear here once a destination accepts them."
      initialFilters={initialFilters}
    />
  );
}
