"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { QueueJobsTable } from "@/components/delivery/queue-jobs-table";
import { Select } from "@/components/ui/select";
import { useDeadLetterJobs } from "@/lib/queries/delivery";

/**
 * The API appends the `-dlq` suffix when it is missing, so the picker shows
 * base queue names while the request resolves to `<queue>-dlq`.
 */
const QUEUES = [
  "delivery",
  "lead-intake",
  "lead-processing",
  "routing",
  "scoring",
  "enrichment",
  "retry",
  "csv-import",
] as const;

export default function DeadLetterPage() {
  const [queue, setQueue] = useState<string>("delivery");
  const jobs = useDeadLetterJobs(queue);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Dead Letter"
        description="Jobs moved to the dead-letter queue after exhausting every retry — refreshed every 30s."
        actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Queue
            <Select
              value={queue}
              onChange={(event) => setQueue(event.target.value)}
              className="w-[190px]"
              aria-label="Queue"
            >
              {QUEUES.map((name) => (
                <option key={name} value={name}>
                  {name}-dlq
                </option>
              ))}
            </Select>
          </label>
        }
      />

      <Card>
        <QueueJobsTable
          rows={jobs.data ?? []}
          isLoading={jobs.isLoading}
          error={jobs.error}
          onRetry={() => void jobs.refetch()}
          emptyTitle={`No dead-letter jobs in "${queue}-dlq"`}
          emptyDescription="Deliveries that exhaust all attempts are parked here with their payload and failure reason intact."
          timestampLabel="Created"
        />
      </Card>
    </div>
  );
}
