"use client";

import { LeadsView } from "@/components/leads/leads-view";

export default function FailedLeadsPage() {
  return (
    <LeadsView
      title="Failed"
      description="Leads that failed processing or delivery (API status filter: FAILED)."
      presetStatus="FAILED"
      emptyTitle="No failed leads"
      emptyDescription="Leads that cannot be processed or delivered will be listed here with their error detail."
    />
  );
}
