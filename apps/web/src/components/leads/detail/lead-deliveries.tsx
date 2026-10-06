"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { JsonViewer } from "@/components/ui/json-viewer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMPTY, formatDateTime, formatDuration, truncate } from "@/lib/format";
import { deliveryStatusVariant } from "@/lib/status";
import type { DeliveryAttempt, DeliveryStatus, LeadDelivery } from "@/lib/types";

function AttemptRow({ attempt }: { attempt: DeliveryAttempt }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="font-mono text-xs">#{attempt.attemptNumber}</TableCell>
      <TableCell>
        <Badge variant={deliveryStatusVariant[attempt.status as DeliveryStatus] ?? "outline"}>
          {attempt.status}
        </Badge>
      </TableCell>
      <TableCell className="tabular-nums">
        {attempt.responseStatus ?? EMPTY}
      </TableCell>
      <TableCell className="tabular-nums">
        {attempt.durationMs === null || attempt.durationMs === undefined
          ? EMPTY
          : formatDuration(attempt.durationMs)}
      </TableCell>
      <TableCell className="max-w-[320px]">
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {attempt.responseBody ? truncate(attempt.responseBody, 160) : EMPTY}
        </p>
        {attempt.errorCode || attempt.errorCategory ? (
          <p className="mt-0.5 truncate text-[11px] text-destructive">
            {[attempt.errorCategory, attempt.errorCode].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDateTime(attempt.startedAt ?? attempt.finishedAt)}
      </TableCell>
    </TableRow>
  );
}

function DeliveryCard({ delivery }: { delivery: LeadDelivery }) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              aria-label={open ? "Collapse attempts" : "Expand attempts"}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{delivery.destination.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {delivery.destination.type}
                {delivery.externalId ? (
                  <span className="ml-1.5 font-mono">ext: {delivery.externalId}</span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={deliveryStatusVariant[delivery.status]}>{delivery.status}</Badge>
            <Badge variant="outline">
              attempts {delivery.attemptCount}/{delivery.maxAttempts}
            </Badge>
          </div>
        </div>

        {delivery.errorCode || delivery.errorMessage ? (
          <p className="mt-2 break-words rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            {[delivery.errorCode, delivery.errorMessage].filter(Boolean).join(": ")}
          </p>
        ) : null}

        {open ? (
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            {delivery.attempts.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                No attempts recorded for this delivery.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">#</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[90px] text-right">HTTP</TableHead>
                    <TableHead className="w-[100px] text-right">Duration</TableHead>
                    <TableHead>Response / error</TableHead>
                    <TableHead className="w-[160px]">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...delivery.attempts]
                    .sort((a, b) => a.attemptNumber - b.attemptNumber)
                    .map((attempt) => (
                      <AttemptRow key={attempt.id} attempt={attempt} />
                    ))}
                </TableBody>
              </Table>
            )}
          </div>
        ) : null}

        {delivery.mappedPayload ? (
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
              Mapped payload
            </summary>
            <JsonViewer value={delivery.mappedPayload} maxHeight="16rem" className="mt-1.5" />
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function LeadDeliveries({ deliveries }: { deliveries: LeadDelivery[] }) {
  if (deliveries.length === 0) {
    return (
      <Card>
        <CardContent className="px-5 py-10 text-center text-xs text-muted-foreground">
          No deliveries have been created for this lead yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {deliveries.map((delivery) => (
        <DeliveryCard key={delivery.id} delivery={delivery} />
      ))}
    </div>
  );
}
