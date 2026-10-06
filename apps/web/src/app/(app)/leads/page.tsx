"use client";

import { LeadsView } from "@/components/leads/leads-view";

export default function LeadsPage() {
  return (
    <LeadsView
      title="All Leads"
      emptyTitle="No leads yet"
      emptyDescription="Leads will appear here as soon as they arrive through webhooks, API calls or imports."
    />
  );
}
