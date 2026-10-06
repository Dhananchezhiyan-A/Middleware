"use client";

import { LeadsView } from "@/components/leads/leads-view";

export default function DeliveredLeadsPage() {
  return (
    <LeadsView
      title="Delivered"
      description="Leads that completed the full pipeline (API status filter: PROCESSED). Per-destination delivery detail lives on the lead page and under Delivery."
      presetStatus="PROCESSED"
      emptyTitle="No delivered leads yet"
      emptyDescription="Leads show up here once validation, deduplication, scoring, routing and delivery all succeed."
    />
  );
}
