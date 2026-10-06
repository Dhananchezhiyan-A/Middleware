"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, truncate } from "@/lib/format";
import type { RoutingResult } from "@/lib/types";

export function LeadRouting({ results }: { results: RoutingResult[] }) {
  if (results.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No routing results"
          description="Routing runs after scoring; results appear once rules have been evaluated for this lead."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Routing results</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead className="w-[100px]">Matched</TableHead>
              <TableHead>Destinations</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="w-[160px]">Evaluated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((result) => (
              <TableRow key={result.id}>
                <TableCell>
                  <p className="font-medium">{result.ruleName ?? "—"}</p>
                  {result.ruleId ? (
                    <p className="font-mono text-[11px] text-muted-foreground">{result.ruleId}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={result.matched ? "success" : "secondary"}>
                    {result.matched ? "MATCHED" : "NO MATCH"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {result.destinationIds && result.destinationIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {result.destinationIds.map((id) => (
                        <Badge key={id} variant="outline" className="font-mono">
                          {id}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                  {result.reason ? truncate(result.reason, 160) : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDateTime(result.evaluatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
