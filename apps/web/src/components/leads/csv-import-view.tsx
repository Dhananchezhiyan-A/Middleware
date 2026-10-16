"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Upload,
} from "lucide-react";
import type { CsvColumnMapping } from "@middleware/types";
import { PageHeader } from "@/components/page-header";
import { CsvFileDrop } from "@/components/leads/csv-file-drop";
import { CsvMappingTable } from "@/components/leads/csv-mapping-table";
import { CsvPreviewTable } from "@/components/leads/csv-preview-table";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { FieldLabel } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import {
  CsvPreviewError,
  mappingProblems,
  readCsvFile,
  validateRows,
  withTarget,
  type CsvFilePreview,
} from "@/lib/csv";
import { formatBytes, formatNumber } from "@/lib/format";
import { useSourceAccounts, useSources } from "@/lib/queries/integrations";
import {
  downloadImportErrors,
  useImportJob,
  useImportJobs,
  useImportRowErrors,
  useUploadImport,
} from "@/lib/queries/imports";
import type { ImportJobItem } from "@/lib/types";

type Step = "select" | "review" | "running" | "done";

const STATUS_TEXT: Record<string, string> = {
  PENDING: "Waiting for a worker…",
  PARSING: "Reading the file…",
  PROCESSING: "Creating leads…",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

function statusVariant(status: string): BadgeProps["variant"] {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "CANCELLED") return "outline";
  return "info";
}

/** Rows that exist in the file but were never attempted (empty rows). */
function skippedRows(job: ImportJobItem): number {
  return Math.max(0, job.totalRows - job.processedRows);
}

/**
 * CSV import wizard: pick a file → review preview + column mapping → import →
 * progress → summary (created / skipped / duplicate / failed) with a failed-row
 * report.
 *
 * Everything the user sees here is produced by the same parser and validator
 * the worker uses; the server re-checks it all on upload.
 */
export function CsvImportView() {
  const { can } = useAuth();
  const { toast } = useToast();

  const canRead = can("imports:read");
  const canWrite = can("imports:write");

  /* ------------------------------------------------------- destination */
  const sources = useSources();
  const [sourceId, setSourceId] = useState("");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const accounts = useSourceAccounts(sourceId || null, canRead);

  const sourceRows = sources.data ?? [];
  const accountRows = accounts.data ?? [];

  // Single source / account: preselect so the common case is one click.
  useEffect(() => {
    if (!sourceId && sourceRows.length === 1) setSourceId(sourceRows[0]?.id ?? "");
  }, [sourceRows, sourceId]);
  useEffect(() => {
    if (sourceAccountId) return;
    if (accountRows.length >= 1) setSourceAccountId(accountRows[0]?.id ?? "");
  }, [accountRows, sourceAccountId]);

  /* ------------------------------------------------------------- file */
  const [step, setStep] = useState<Step>("select");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvFilePreview | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const handleFile = async (picked: File) => {
    setReading(true);
    setFileError(null);
    try {
      const parsed = await readCsvFile(picked);
      setFile(picked);
      setPreview(parsed);
      setMapping(parsed.mapping);
      setStep("review");
    } catch (err) {
      setFile(null);
      setPreview(null);
      setMapping([]);
      setFileError(
        err instanceof CsvPreviewError
          ? err.message
          : errorMessage(err, "That file could not be read as CSV."),
      );
    } finally {
      setReading(false);
    }
  };

  const issues = useMemo(
    () => (preview ? validateRows(preview.records, preview.rowNumbers, mapping) : []),
    [preview, mapping],
  );
  const problems = useMemo(
    () => (preview ? mappingProblems(mapping, preview.headers) : []),
    [preview, mapping],
  );

  /* ----------------------------------------------------------- import */
  const upload = useUploadImport();
  const [jobId, setJobId] = useState<string | null>(null);
  const jobQuery = useImportJob(jobId ?? "", jobId !== null);
  const job = jobQuery.data ?? null;

  const startImport = async () => {
    if (!file || !preview) return;
    if (!sourceId) {
      toast({ title: "Select a source", description: "Imports must be attached to a source.", variant: "error" });
      return;
    }
    try {
      const created = await upload.mutateAsync({
        file,
        sourceId,
        ...(sourceAccountId ? { sourceAccountId } : {}),
        mapping,
      });
      setJobId(created.id);
      setStep("running");
    } catch (err) {
      toast({ title: "Could not start the import", description: errorMessage(err), variant: "error" });
    }
  };

  const terminal = job !== null && ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status);
  useEffect(() => {
    if (terminal && step === "running") setStep("done");
  }, [terminal, step]);

  const rowErrorsQuery = useImportRowErrors(jobId ?? "", step === "done" && (job?.failedRows ?? 0) > 0);

  const [downloading, setDownloading] = useState(false);
  const downloadReport = async () => {
    if (!job) return;
    setDownloading(true);
    try {
      await downloadImportErrors(job);
    } catch (err) {
      toast({ title: "Could not download the error report", description: errorMessage(err), variant: "error" });
    } finally {
      setDownloading(false);
    }
  };

  const recentImports = useImportJobs(5);
  const reset = () => {
    setStep("select");
    setFile(null);
    setPreview(null);
    setMapping([]);
    setFileError(null);
    setJobId(null);
  };

  /* -------------------------------------------------------------- render */
  if (!canRead) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader title="Import leads from CSV" />
        <Card>
          <EmptyState
            title="You do not have access to imports"
            description="Ask an administrator for the imports:read / imports:write permissions to upload lead files."
            action={
              <Link href="/leads">
                <Button variant="outline" size="sm">
                  <ArrowLeft /> Back to leads
                </Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const importDisabled =
    !file || !preview || !sourceId || problems.length > 0 || upload.isPending || !canWrite;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Import leads from CSV"
        description="Upload a CSV file, map its columns to lead fields and review every row before anything is created. Nothing is imported until you confirm."
        actions={
          <Link href="/leads">
            <Button variant="outline" size="sm">
              <ArrowLeft /> Back to leads
            </Button>
          </Link>
        }
      />

      {/* ---------------------------------------------------- destination */}
      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabel label="Source" required hint="Where the imported leads come from" />
            <Select
              className="mt-1.5"
              value={sourceId}
              disabled={sources.isLoading || step === "running" || step === "done"}
              onChange={(event) => {
                setSourceId(event.target.value);
                setSourceAccountId("");
              }}
              aria-label="Source"
            >
              <option value="">
                {sources.isLoading ? "Loading sources…" : "Select a source…"}
              </option>
              {sourceRows.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
            {!sources.isLoading && sourceRows.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                No sources yet — create one before importing leads.
              </p>
            ) : null}
          </div>

          <div>
            <FieldLabel label="Source account" required hint="Receives the imported leads" />
            <Select
              className="mt-1.5"
              value={sourceAccountId}
              disabled={!sourceId || accounts.isLoading || step === "running" || step === "done"}
              onChange={(event) => setSourceAccountId(event.target.value)}
              aria-label="Source account"
            >
              <option value="">
                {!sourceId
                  ? "Select a source first…"
                  : accounts.isLoading
                    ? "Loading accounts…"
                    : "Select an account…"}
              </option>
              {accountRows.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
            {sourceId && !accounts.isLoading && accountRows.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                This source has no account yet — create one first.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------ file */}
      {step === "select" ? (
        <Card className="mt-4 p-5">
          <CsvFileDrop
            onFile={(picked) => void handleFile(picked)}
            busy={reading}
            error={fileError}
            disabled={upload.isPending}
          />
        </Card>
      ) : null}

      {step === "review" && file && preview ? (
        <>
          <Card className="mt-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground" title={file.name}>
                  {file.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatBytes(file.size)} · {formatNumber(preview.headers.length)} columns ·{" "}
                  {formatNumber(preview.totalRows)} data rows
                  {preview.skippedRows > 0
                    ? ` · ${formatNumber(preview.skippedRows)} empty (will be skipped)`
                    : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                Choose another file
              </Button>
            </div>

            <div className="mt-4">
              <CsvMappingTable
                headers={preview.headers}
                mapping={mapping}
                previewRows={preview.previewRows}
                onChange={(column, target) => setMapping((current) => withTarget(current, column, target))}
              />
            </div>

            {problems.length > 0 ? (
              <div
                role="alert"
                className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3"
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                  <AlertTriangle className="size-3.5" /> Fix before importing
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-destructive">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-3">
              <Button variant="outline" onClick={reset} disabled={upload.isPending}>
                Cancel
              </Button>
              <div className="flex items-center gap-3">
                {!canWrite ? (
                  <span className="text-xs text-muted-foreground">
                    You need the imports:write permission to import.
                  </span>
                ) : null}
                <Button onClick={() => void startImport()} disabled={importDisabled}>
                  {upload.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Upload />
                  )}
                  Import {formatNumber(preview.totalRows)} rows
                </Button>
              </div>
            </div>
          </Card>

          {/* Preview + validation (visible BEFORE the upload). */}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Preview</h2>
              <CsvPreviewTable
                headers={preview.headers}
                previewRows={preview.previewRows}
                totalRows={preview.totalRows}
                issues={issues}
              />
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                Row validation ({formatNumber(preview.totalRows - issues.length)} of{" "}
                {formatNumber(preview.totalRows)} rows valid)
              </h2>
              {issues.length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-emerald-500" /> Every row has a contact
                  channel and valid values.
                </p>
              ) : (
                <>
                  <div
                    role="status"
                    className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400"
                  >
                    {formatNumber(issues.length)} row(s) will be rejected by the importer and
                    reported with their row number — they are never silently dropped.
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead>Why it will fail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {issues.slice(0, 25).map((issue) => (
                        <TableRow key={issue.rowNumber}>
                          <TableCell className="text-xs">{issue.rowNumber}</TableCell>
                          <TableCell className="text-xs text-destructive">
                            {issue.reasons.join(" ")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {issues.length > 25 ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      …and {formatNumber(issues.length - 25)} more (the full list is in the error
                      report after the import).
                    </p>
                  ) : null}
                </>
              )}
            </Card>
          </div>
        </>
      ) : null}

      {/* -------------------------------------------------------- progress */}
      {step === "running" && job ? (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm font-medium text-foreground">
                {STATUS_TEXT[job.status] ?? job.status}
              </span>
              <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {formatNumber(job.processedRows)} / {formatNumber(job.totalRows)} rows processed
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${
                  job.totalRows > 0 ? Math.min(100, (job.processedRows / job.totalRows) * 100) : 0
                }%`,
              }}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The import keeps running in the background — you can leave this page and come back.
          </p>
        </Card>
      ) : null}
      {step === "running" && !job && upload.isPending ? (
        <Card className="mt-4 p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Uploading {file ? file.name : "file"}…
          </p>
        </Card>
      ) : null}

      {/* --------------------------------------------------------- summary */}
      {step === "done" && job ? (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {job.status === "COMPLETED" ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="size-4 text-destructive" />
              )}
              <h2 className="text-sm font-semibold text-foreground">
                {job.status === "COMPLETED" ? "Import finished" : `Import ${job.status.toLowerCase()}`}
              </h2>
              <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">{job.fileName}</span>
          </div>

          {job.error ? (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {job.error}
            </p>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <SummaryTile label="Rows in file" value={job.totalRows} />
            <SummaryTile label="Created" value={job.successfulRows} tone="success" />
            <SummaryTile label="Skipped (empty)" value={skippedRows(job)} />
            <SummaryTile label="Duplicates" value={job.duplicateRows} tone="info" />
            <SummaryTile label="Failed" value={job.failedRows} tone={job.failedRows > 0 ? "danger" : undefined} />
          </dl>

          {job.failedRows > 0 ? (
            <div className="mt-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-foreground">
                  Failed rows ({formatNumber(job.failedRows)})
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void downloadReport()}
                  disabled={downloading}
                >
                  {downloading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  Download error report (CSV)
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Row</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rowErrorsQuery.data?.items ?? []).map((row) => (
                    <TableRow key={`${row.rowNumber}-${row.error}`}>
                      <TableCell className="text-xs">{row.rowNumber}</TableCell>
                      <TableCell className="text-xs text-destructive">{row.error}</TableCell>
                    </TableRow>
                  ))}
                  {(rowErrorsQuery.data?.items ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-xs text-muted-foreground">
                        {rowErrorsQuery.isLoading ? "Loading failed rows…" : "No failed rows."}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                The downloaded report also contains the raw CSV values for each failed row.
              </p>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={reset}>Import another file</Button>
            <Link href="/leads">
              <Button variant="outline">View leads</Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {/* --------------------------------------------------------- recent */}
      {step === "select" && (recentImports.data?.items.length ?? 0) > 0 ? (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Recent imports</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-40">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recentImports.data?.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-[280px] truncate text-xs" title={item.fileName}>
                    {item.fileName}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatNumber(item.successfulRows)} created ·{" "}
                    {formatNumber(item.failedRows)} failed
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "info" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "info"
        ? "text-sky-600 dark:text-sky-400"
        : tone === "danger"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>
        {formatNumber(value)}
      </dd>
    </div>
  );
}
