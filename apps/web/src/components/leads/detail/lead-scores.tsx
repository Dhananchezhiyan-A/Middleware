"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonViewer } from "@/components/ui/json-viewer";
import { EmptyState } from "@/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { LeadScore } from "@/lib/types";

export function LeadScores({ scores, activeVersion }: { scores: LeadScore[]; activeVersion?: string | null }) {
  if (scores.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No scores computed"
          description="Scoring runs after deduplication when a scoring rule set is active."
        />
      </Card>
    );
  }

  // Versions are strings ("1", "2", …) — sort numerically with a safe fallback.
  const versionRank = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  const sorted = [...scores].sort((a, b) => versionRank(b.version) - versionRank(a.version));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scores</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[90px]">Version</TableHead>
              <TableHead className="w-[110px] text-right">Score</TableHead>
              <TableHead className="w-[180px]">Computed</TableHead>
              <TableHead>Breakdown</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((score) => (
              <TableRow key={score.id}>
                <TableCell>
                  <Badge variant={score.version === activeVersion ? "default" : "outline"}>
                    v{score.version}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatNumber(score.score)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDateTime(score.computedAt)}
                </TableCell>
                <TableCell>
                  <details>
                    <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
                      View breakdown
                    </summary>
                    <JsonViewer value={score.breakdown} maxHeight="14rem" className="mt-1.5" />
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
