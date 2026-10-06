"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonViewer } from "@/components/ui/json-viewer";
import { EMPTY, formatDateTime, formatNumber } from "@/lib/format";
import type { LeadCanonicalData, LeadDetail } from "@/lib/types";

function kv(label: string, value: string | number | undefined | null) {
  return (
    <div
      key={label}
      className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0"
    >
      <dt className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right text-xs">
        {value === null || value === undefined || value === "" ? EMPTY : value}
      </dd>
    </div>
  );
}

function canonicalRows(data: LeadCanonicalData) {
  const name =
    data.name?.full ||
    [data.name?.first, data.name?.last].filter(Boolean).join(" ") ||
    undefined;
  const location = [data.location?.city, data.location?.state, data.location?.country]
    .filter(Boolean)
    .join(", ");

  return [
    kv("Name", name),
    kv("Email", data.email),
    kv("Phone", data.phone),
    kv("Location", location),
    kv(
      "Budget",
      data.budget === undefined || data.budget === null
        ? undefined
        : `${formatNumber(data.budget)}${data.currency ? ` ${data.currency}` : ""}`,
    ),
    kv("Currency", data.currency),
    kv("Project", data.project),
  ];
}

export function LeadOverview({ lead }: { lead: LeadDetail }) {
  const processing = lead.processing;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Canonical data</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>{canonicalRows(lead.canonicalData)}</dl>

          {lead.canonicalData.custom && Object.keys(lead.canonicalData.custom).length > 0 ? (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Custom fields
              </p>
              <JsonViewer value={lead.canonicalData.custom} maxHeight="16rem" />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Processing</CardTitle>
            {processing ? (
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">validation: {processing.validationStatus ?? EMPTY}</Badge>
                <Badge variant="outline">dedup: {processing.deduplicationStatus ?? EMPTY}</Badge>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!processing ? (
            <p className="text-xs text-muted-foreground">
              No processing record has been attached to this lead yet.
            </p>
          ) : (
            <>
              <dl>
                {kv("Started", formatDateTime(processing.startedAt))}
                {kv("Finished", formatDateTime(processing.finishedAt))}
                {kv("Error", processing.error)}
              </dl>
              {processing.error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {processing.error}
                </div>
              ) : null}
            </>
          )}

          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              Normalized data
            </p>
            <JsonViewer value={lead.normalizedData} maxHeight="14rem" emptyLabel="No normalized data stored." />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
