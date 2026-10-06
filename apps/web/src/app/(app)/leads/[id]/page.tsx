import type { Metadata } from "next";
import { LeadDetail } from "@/components/leads/detail/lead-detail";

export const metadata: Metadata = { title: "Lead detail" };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetail id={id} />;
}
