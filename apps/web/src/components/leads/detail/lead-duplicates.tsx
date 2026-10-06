"use client";

import Link from "next/link";
import { ArrowUpRight, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, formatPercent } from "@/lib/format";
import type { LeadDetail } from "@/lib/types";

export function LeadDuplicates({ lead }: { lead: LeadDetail }) {
  const duplicateOf = lead.duplicateOf;

  if (!duplicateOf) {
    return (
      <Card>
        <EmptyState
          icon={<Scale className="size-5" />}
          title="No duplicate relationships"
          description="This lead was not matched against another lead by the active deduplication strategy."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/automation/deduplication">Deduplication settings</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Marked as duplicate of</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Original lead</p>
            <Link
              href={`/leads/${duplicateOf.originalLeadId}`}
              className="mt-0.5 inline-flex items-center gap-1 font-mono text-primary hover:underline"
            >
              {duplicateOf.originalLeadId}
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Strategy</p>
            <Badge variant="outline" className="mt-0.5">
              {duplicateOf.strategy}
            </Badge>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Confidence</p>
            <p className="mt-0.5 font-medium">
              {duplicateOf.confidence === null || duplicateOf.confidence === undefined
                ? "—"
                : formatPercent(duplicateOf.confidence)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Detected</p>
            <p className="mt-0.5">{formatDateTime(duplicateOf.createdAt)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Reverse links (later leads that duplicated this one) are recorded in the database but
            are not exposed by a Phase&nbsp;1 endpoint. Query them from{" "}
            <span className="font-mono text-foreground">/leads</span> once the duplicates endpoint
            ships in Phase&nbsp;2.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
