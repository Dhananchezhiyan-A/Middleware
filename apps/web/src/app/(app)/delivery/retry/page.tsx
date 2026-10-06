"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { QueueJobsTable } from "@/components/delivery/queue-jobs-table";
import { Select } from "@/components/ui/select";
import { useFailedJobs } from "@/lib/queries/delivery";

/** BullMQ queue names known to the platform (queue-stats keys). */
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

export default function DeliveryRetryPage() {
  const [queue, setQueue] = useState<string>("delivery");
  const jobs = useFailedJobs(queue);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Retry"
        description="Failed BullMQ jobs per queue, with attempts made and the next scheduled retry — refreshed every 30s."
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
                  {name}
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
          emptyTitle={`No failed jobs in "${queue}"`}
          emptyDescription="Jobs appear here after BullMQ exhausts an immediate attempt; the worker reschedules them with exponential backoff."
          timestampLabel="Retry at"
        />
      </Card>
    </div>
  );
}
