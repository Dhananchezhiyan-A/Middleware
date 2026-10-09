import { LeadsView } from "@/components/leads/leads-view";
import { readListFilterParams, type SearchParamsValue } from "@/lib/range";

interface FailedLeadsPageProps {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}

export default async function FailedLeadsPage({ searchParams }: FailedLeadsPageProps) {
  const initialFilters = readListFilterParams(await searchParams);

  return (
    <LeadsView
      title="Failed"
      description="Leads that failed processing or delivery (API status filter: FAILED)."
      presetStatus="FAILED"
      emptyTitle="No failed leads"
      emptyDescription="Leads that cannot be processed or delivered will be listed here with their error detail."
      initialFilters={initialFilters}
    />
  );
}
