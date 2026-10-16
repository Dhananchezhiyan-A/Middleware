"use client";

import { CsvImportView } from "@/components/leads/csv-import-view";

/**
 * CSV import screen (`/leads/import`) — reached from the "Upload CSV" action
 * on the Leads page. Client component: the whole flow (preview, mapping,
 * progress) is interactive.
 */
export default function ImportPage() {
  return <CsvImportView />;
}
