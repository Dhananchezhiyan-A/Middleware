"use client";

import { useState, type FormEvent } from "react";
import { Eye, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { formatDateTime, truncate } from "@/lib/format";
import { auditRows, useAuditLogs, type AuditLogParams } from "@/lib/queries/system";
import type { AuditLogItem } from "@/lib/types";

type Draft = AuditLogParams;

const EMPTY_DRAFT: Draft = { action: "", entityType: "", entityId: "", from: "", to: "" };

function toIso(date: string, endOfDay: boolean): string | undefined {
  if (!date) return undefined;
  return endOfDay ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
}

function actorTypeVariant(actorType: string) {
  switch (actorType) {
    case "USER":
      return "info" as const;
    case "API_KEY":
      return "purple" as const;
    case "WORKER":
    case "SYSTEM":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export default function AuditLogsPage() {
  // Draft vs applied: filters hit the API only on Apply, so typing an id
  // does not fire a query per keystroke.
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<Draft>({});
  const [inspect, setInspect] = useState<AuditLogItem | null>(null);

  const logs = useAuditLogs(applied);
  const rows = auditRows(logs.data);

  const onApply = (event: FormEvent) => {
    event.preventDefault();
    setApplied({
      action: draft.action?.trim() || undefined,
      entityType: draft.entityType?.trim() || undefined,
      entityId: draft.entityId?.trim() || undefined,
      from: toIso(draft.from ?? "", false),
      to: toIso(draft.to ?? "", true),
    });
  };

  const clear = () => {
    setDraft(EMPTY_DRAFT);
    setApplied({});
  };

  const hasFilters = Object.values(applied).some(Boolean);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Audit Logs"
        description="Every mutation is recorded with actor, entity and before/after snapshots. Newest first, cursor paginated."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void logs.refetch()}
            disabled={logs.isFetching}
          >
            <RefreshCw className={logs.isFetching ? "animate-spin" : undefined} />
            Refresh
          </Button>
        }
      />

      <form onSubmit={onApply} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1.5">
          <FieldLabel label="Action" hint="exact match" />
          <Input
            value={draft.action ?? ""}
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            placeholder="lead.created"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel label="Entity type" hint="exact match" />
          <Input
            value={draft.entityType ?? ""}
            onChange={(event) => setDraft({ ...draft, entityType: event.target.value })}
            placeholder="Lead"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel label="Entity id" />
          <Input
            value={draft.entityId ?? ""}
            onChange={(event) => setDraft({ ...draft, entityId: event.target.value })}
            placeholder="cmup…"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel label="From" />
          <Input
            type="date"
            value={draft.from ?? ""}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel label="To" />
          <Input
            type="date"
            value={draft.to ?? ""}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" className="flex-1">
            Apply
          </Button>
          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
          ) : null}
        </div>
      </form>

      <Card>
        {logs.isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : logs.error ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No audit entries match"
            description="Adjust the filters — audit rows exist for every mutation in this application."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead className="w-[150px]">Request</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{entry.action}</span>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs">{entry.entityType}</p>
                    {entry.entityId ? (
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {entry.entityId}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={actorTypeVariant(entry.actorType)}>{entry.actorType}</Badge>
                      <span className="truncate text-xs text-muted-foreground" title={entry.actorLabel ?? ""}>
                        {truncate(entry.actorLabel, 32) || "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="truncate font-mono text-[11px] text-muted-foreground">
                    {truncate(entry.correlationId, 12) || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Inspect audit payload"
                      onClick={() => setInspect(entry)}
                    >
                      <Eye />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {logs.hasNextPage ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-3 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void logs.fetchNextPage()}
                      disabled={logs.isFetchingNextPage}
                    >
                      {logs.isFetchingNextPage ? "Loading…" : "Load more"}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={inspect !== null} onOpenChange={(next) => (!next ? setInspect(null) : undefined)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{inspect?.action ?? ""}</DialogTitle>
          </DialogHeader>
          {inspect ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Time</dt>
                <dd>{formatDateTime(inspect.createdAt)}</dd>
                <dt className="text-muted-foreground">Entity</dt>
                <dd className="font-mono">{inspect.entityType}</dd>
                <dt className="text-muted-foreground">Entity id</dt>
                <dd className="break-all font-mono">{inspect.entityId ?? "—"}</dd>
                <dt className="text-muted-foreground">Actor</dt>
                <dd>
                  {inspect.actorLabel ?? "—"} ({inspect.actorType})
                </dd>
                <dt className="text-muted-foreground">IP</dt>
                <dd className="font-mono">{inspect.ip ?? "—"}</dd>
                <dt className="text-muted-foreground">Correlation</dt>
                <dd className="break-all font-mono">{inspect.correlationId ?? "—"}</dd>
              </dl>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground">Metadata</p>
                <JsonViewer value={inspect.metadata ?? null} emptyLabel="No metadata." />
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground">Before</p>
                <JsonViewer value={inspect.before ?? null} emptyLabel="No before snapshot." />
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground">After</p>
                <JsonViewer value={inspect.after ?? null} emptyLabel="No after snapshot." />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
