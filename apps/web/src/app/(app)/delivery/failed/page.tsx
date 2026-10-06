"use client";

import { DeliveryView } from "@/components/delivery/delivery-view";

export default function FailedDeliveriesPage() {
  return (
    <DeliveryView
      title="Failed"
      description="Deliveries whose latest attempt failed but that can still be replayed (status: FAILED)."
      presetStatus="FAILED"
      emptyTitle="No failed deliveries"
      emptyDescription="A delivery lands here when an attempt fails and retries are still available. Use the replay action to start a fresh attempt cycle."
    />
  );
}
