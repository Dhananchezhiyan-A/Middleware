"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileJson } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { JsonViewer } from "@/components/ui/json-viewer";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { TableSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMPTY, formatDateTime, truncate } from "@/lib/format";
import { useLeadAudit } from "@/lib/queries/leads";
import type { LeadAuditEntry } from "@/lib/types";

function AuditRow({ entry }: { entry: LeadAuditEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setOpen((prev) => !prev)}>
        <TableCell className="w-[24px] pr-0">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </TableCell>
        <TableCell>
          <p className="font-medium">{entry.action}</p>
          <p className="text-[11px] text-muted-foreground">
            {entry.actorLabel ?? EMPTY}
            {entry.actorType ? ` · ${entry.actorType}` : ""}
          </p>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{entry.entityType ?? EMPTY}</Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatDateTime(entry.createdAt)}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="bg-background/40 p-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Before
                </p>
                <JsonViewer value={entry.before} maxHeight="14rem" emptyLabel="—" />
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  After
                </p>
                <JsonViewer value={entry.after} maxHeight="14rem" emptyLabel="—" />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              {entry.metadata ? (
                <span className="font-mono">
                  metadata: {truncate(JSON.stringify(entry.metadata), 160)}
                </span>
              ) : null}
              {entry.correlationId ? (
                <span className="font-mono">correlationId: {entry.correlationId}</span>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function LeadAudit({ leadId }: { leadId: string }) {
  const { data, isLoading, error, refetch } = useLeadAudit(leadId);

  if (isLoading) return <TableSkeleton rows={5} cols={4} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No audit history"
          description="Audit entries for this lead will appear here."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[24px] pr-0" />
              <TableHead>Action</TableHead>
              <TableHead className="w-[140px]">Entity</TableHead>
              <TableHead className="w-[170px]">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function LeadRawPayloads({ payloads }: { payloads: { id: string; payload: unknown; headers?: Record<string, unknown> | null; checksum?: string | null; receivedAt: string }[] }) {
  if (payloads.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileJson className="size-5" />}
          title="No raw payloads stored"
          description="The original inbound payload is stored per webhook/API event when intake completes."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {payloads.map((raw) => (
        <Card key={raw.id}>
          <CardContent className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{raw.id}</span>
                <span>{formatDateTime(raw.receivedAt)}</span>
                {raw.checksum ? (
                  <span className="font-mono">sha: {truncate(raw.checksum, 16)}</span>
                ) : null}
              </div>
              <CopyButton value={JSON.stringify(raw.payload, null, 2)} label="Copy JSON" />
            </div>
            <JsonViewer value={raw.payload} maxHeight="22rem" />
            {raw.headers && Object.keys(raw.headers).length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
                  Headers
                </summary>
                <JsonViewer value={raw.headers} maxHeight="12rem" className="mt-1.5" />
              </details>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
