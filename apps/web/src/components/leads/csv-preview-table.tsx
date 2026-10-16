"use client";

import { AlertTriangle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableCaption,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import type { PreviewRow, RowIssue } from "@/lib/csv";

export interface CsvPreviewTableProps {
  headers: readonly string[];
  previewRows: readonly PreviewRow[];
  /** Every data row in the file (not only the previewed ones). */
  totalRows: number;
  issues: readonly RowIssue[];
  /** Very wide files are truncated here; the mapping table shows them all. */
  maxColumns?: number;
}

/**
 * Read-only preview of the first rows of the file.
 *
 * Rows that would fail validation are flagged here (and listed underneath),
 * so problems are visible BEFORE anything is uploaded.
 */
export function CsvPreviewTable({
  headers,
  previewRows,
  totalRows,
  issues,
  maxColumns = 15,
}: CsvPreviewTableProps) {
  const issueByRow = new Map(issues.map((issue) => [issue.rowNumber, issue.reasons]));
  const visibleHeaders = headers.slice(0, maxColumns);
  const hiddenColumns = headers.length - visibleHeaders.length;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Row</TableHead>
          {visibleHeaders.map((header) => (
            <TableHead key={header}>{header || "—"}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {previewRows.map((row) => {
          const reasons = issueByRow.get(row.rowNumber);
          return (
            <TableRow key={row.rowNumber} className={reasons ? "bg-destructive/5" : undefined}>
              <TableCell className="align-top">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {reasons ? <AlertTriangle className="size-3.5 text-destructive" /> : null}
                  {row.rowNumber}
                </span>
                {reasons ? (
                  <Badge variant="danger" className="mt-1">
                    will fail
                  </Badge>
                ) : null}
              </TableCell>
              {visibleHeaders.map((header) => (
                <TableCell key={header} className="max-w-[220px] truncate align-top text-xs">
                  {row.values[header] || <span className="text-muted-foreground">—</span>}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
      <TableCaption>
        Showing the first {formatNumber(previewRows.length)} of {formatNumber(totalRows)} data rows.
        {hiddenColumns > 0
          ? ` ${formatNumber(hiddenColumns)} more column(s) are shown in the mapping table.`
          : ""}
      </TableCaption>
    </Table>
  );
}
