import { LeadsView } from "@/components/leads/leads-view";
import { readListFilterParams, type SearchParamsValue } from "@/lib/range";

interface ProcessingLeadsPageProps {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}

export default async function ProcessingLeadsPage({ searchParams }: ProcessingLeadsPageProps) {
  const initialFilters = readListFilterParams(await searchParams);

  return (
    <LeadsView
      title="Processing"
      description="Leads currently moving through the pipeline (API status filter: PROCESSING)."
      presetStatus="PROCESSING"
      emptyTitle="Nothing is processing"
      emptyDescription="Leads appear here while they are being validated, normalized, scored and routed."
      initialFilters={initialFilters}
    />
  );
}
