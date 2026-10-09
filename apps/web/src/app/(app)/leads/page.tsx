import { LeadsView } from "@/components/leads/leads-view";
import { readListFilterParams, type SearchParamsValue } from "@/lib/range";

interface LeadsPageProps {
  /** Next.js passes searchParams as a promise — awaited, then mapped to filters. */
  searchParams: Promise<Record<string, SearchParamsValue>>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const initialFilters = readListFilterParams(await searchParams);

  return (
    <LeadsView
      title="All Leads"
      emptyTitle="No leads yet"
      emptyDescription="Leads will appear here as soon as they arrive through webhooks, API calls or imports."
      initialFilters={initialFilters}
    />
  );
}
