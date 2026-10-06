"use client";

import { DeliveryView } from "@/components/delivery/delivery-view";

export default function SuccessfulDeliveriesPage() {
  return (
    <DeliveryView
      title="Successful"
      description="Deliveries that reached the destination with a 2xx response (status: SUCCEEDED)."
      presetStatus="SUCCEEDED"
      emptyTitle="No successful deliveries yet"
      emptyDescription="Deliveries appear here once a destination accepts them."
    />
  );
}
