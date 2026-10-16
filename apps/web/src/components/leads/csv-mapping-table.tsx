"use client";

import type { CsvColumnMapping } from "@middleware/types";
import { LeadFieldSelect } from "@/components/automation/lead-field-select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PreviewRow } from "@/lib/csv";

export interface CsvMappingTableProps {
  /** Header row of the uploaded file (verbatim, as parsed). */
  headers: readonly string[];
  mapping: readonly CsvColumnMapping[];
  /** First rows of the file — used to show an example value per column. */
  previewRows: readonly PreviewRow[];
  onChange: (column: string, target: string) => void;
}

/** First non-empty example for a column (from the previewed rows). */
function sampleFor(column: string, previewRows: readonly PreviewRow[]): string {
  for (const row of previewRows) {
    const value = row.values[column];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return "";
}

/**
 * One row per CSV column: where that column lands in the canonical lead.
 *
 * Every column starts on the header-alias suggestion; the user can re-point a
 * column at any lead field or clear it to skip the column entirely.
 */
export function CsvMappingTable({ headers, mapping, previewRows, onChange }: CsvMappingTableProps) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Each CSV column is matched to a Middleware lead field. Clear a field to skip that column.
        </p>
        <span className="text-[11px] text-muted-foreground">
          {mapping.filter((entry) => entry.target !== "").length} of {headers.length} columns
          imported
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[22%]">CSV column</TableHead>
            <TableHead className="w-[26%]">Example value</TableHead>
            <TableHead>Lead field</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {headers.map((header) => {
            const entry = mapping.find((item) => item.column === header);
            const target = entry?.target ?? "";
            const sample = sampleFor(header, previewRows);
            const usedValues = mapping
              .filter((item) => item.column !== header && item.target !== "")
              .map((item) => item.target);
            return (
              <TableRow key={header}>
                <TableCell>
                  <span className="block max-w-[220px] truncate font-mono text-xs" title={header}>
                    {header}
                  </span>
                  {target === "" ? (
                    <Badge variant="outline" className="mt-1">
                      Not imported
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span className="block max-w-[260px] truncate text-xs text-muted-foreground">
                    {sample || "—"}
                  </span>
                </TableCell>
                <TableCell className="min-w-[240px]">
                  <LeadFieldSelect
                    value={target}
                    onChange={(next) => onChange(header, next)}
                    usedValues={usedValues}
                    ariaLabel={`Lead field for column ${header}`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
