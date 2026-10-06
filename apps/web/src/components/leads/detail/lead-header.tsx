"use client";

import Link from "next/link";
import { ArrowLeft, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyableValue } from "@/components/ui/copy-button";
import { EMPTY, formatDateTime, formatNumber } from "@/lib/format";
import { leadStatusVariant, stageVariant } from "@/lib/status";
import type { LeadDetail } from "@/lib/types";

export interface LeadHeaderProps {
  lead: LeadDetail;
  canReplay: boolean;
  replayPending: boolean;
  onReplay: () => void;
}

export function LeadHeader({ lead, canReplay, replayPending, onReplay }: LeadHeaderProps) {
  // Replaying an in-flight lead (RECEIVED/PROCESSING) would double-process it.
  const inFlight = lead.status === "RECEIVED" || lead.status === "PROCESSING";
  const replayDisabled = !canReplay || inFlight || replayPending;

  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/leads"
            className="mb-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> All leads
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-base font-semibold tracking-tight">
              {lead.externalLeadId || lead.id}
            </h1>
            <Badge variant={leadStatusVariant[lead.status]}>{lead.status}</Badge>
            <Badge variant={stageVariant[lead.stage]}>{lead.stage}</Badge>
            {lead.externalLeadId ? (
              <Badge variant="outline" className="font-mono">
                {lead.id}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-md border border-border bg-background/60 px-3 py-1.5 text-right">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Score</p>
            <p className="text-sm font-semibold tabular-nums">
              {lead.score === null || lead.score === undefined ? EMPTY : formatNumber(lead.score)}
              {lead.scoreVersion ? (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  v{lead.scoreVersion}
                </span>
              ) : null}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onReplay}
            disabled={replayDisabled}
            title={
              !canReplay
                ? "Missing permission leads:replay (the API enforces this server-side)."
                : inFlight
                  ? "A lead can only be replayed once it has left the pipeline."
                  : "Requeue this lead for processing."
            }
          >
            <RotateCw className={replayPending ? "animate-spin" : undefined} />
            Replay
          </Button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">ID</dt>
          <dd className="mt-0.5 break-all font-mono">{lead.id}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Lead ID</dt>
          <dd className="mt-0.5 font-mono">{lead.leadId}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Source</dt>
          <dd className="mt-0.5">
            {lead.source.name}
            <Badge variant="outline" className="ml-1.5">
              {lead.source.type}
            </Badge>
            {lead.source.code ? (
              <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                {lead.source.code}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Source account
          </dt>
          <dd className="mt-0.5">
            {lead.sourceAccount ? (
              <>
                {lead.sourceAccount.name}{" "}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {lead.sourceAccount.publicId}
                </span>
              </>
            ) : (
              EMPTY
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Received</dt>
          <dd className="mt-0.5 tabular-nums">{formatDateTime(lead.receivedAt)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Correlation ID
          </dt>
          <dd className="mt-0.5">
            {lead.correlationId ? (
              <CopyableValue value={lead.correlationId} />
            ) : (
              EMPTY
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
