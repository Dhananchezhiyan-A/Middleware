"use client";

import { LeadsView } from "@/components/leads/leads-view";

export default function ProcessingLeadsPage() {
  return (
    <LeadsView
      title="Processing"
      description="Leads currently moving through the pipeline (API status filter: PROCESSING)."
      presetStatus="PROCESSING"
      emptyTitle="Nothing is processing"
      emptyDescription="Leads appear here while they are being validated, normalized, scored and routed."
    />
  );
}
