import { WebhookEventsView } from "@/components/sources/webhook-events-view";
import { readListFilterParams, type SearchParamsValue } from "@/lib/range";

interface WebhookEventsPageProps {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}

/** Inbound webhook event log — the dashboard's "Inbound webhooks (24h)" drill-down. */
export default async function WebhookEventsPage({ searchParams }: WebhookEventsPageProps) {
  const initialFilters = readListFilterParams(await searchParams);
  return <WebhookEventsView initialFilters={initialFilters} />;
}
