import { useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import type { CsvColumnMapping } from "@middleware/types";
import { api, requestBlob } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
import type { ImportJobItem, ImportRowErrorPage } from "@/lib/types";

/** Statuses the UI keeps polling (everything else is terminal). */
const ACTIVE_STATUSES = new Set(["PENDING", "PARSING", "PROCESSING"]);

export interface ImportUploadInput {
  file: File;
  sourceId: string;
  sourceAccountId?: string;
  mapping?: CsvColumnMapping[];
}

/** GET /imports — recent jobs (newest first), perm: imports:read */
export function useImportJobs(limit = 5) {
  const params = { limit };
  return useQuery({
    queryKey: queryKeys.imports.list(params),
    queryFn: () => api.get<{ items: ImportJobItem[] }>("/imports", { query: params }),
  });
}

/** GET /imports/:id — polls every second while the job is running. */
export function useImportJob(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.imports.detail(id),
    enabled: enabled && Boolean(id),
    queryFn: () => api.get<ImportJobItem>(`/imports/${id}`),
    refetchInterval: (query: Query<ImportJobItem>) => {
      const status = query.state.data?.status;
      return status && ACTIVE_STATUSES.has(status) ? 1000 : false;
    },
  });
}

/** GET /imports/:id/row-errors — failed rows (row number + reason). */
export function useImportRowErrors(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.imports.rowErrors(id),
    enabled: enabled && Boolean(id),
    queryFn: () =>
      api.get<ImportRowErrorPage>(`/imports/${id}/row-errors`, { query: { limit: 100 } }),
  });
}

/**
 * POST /imports (multipart) — perm: imports:write.
 * The server re-parses and re-validates the file; nothing the client sent is
 * trusted for anything other than speeding up the UI.
 */
export function useUploadImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportUploadInput) => {
      const formData = new FormData();
      formData.append("file", input.file, input.file.name);
      formData.append("sourceId", input.sourceId);
      if (input.sourceAccountId) formData.append("sourceAccountId", input.sourceAccountId);
      if (input.mapping) formData.append("mapping", JSON.stringify(input.mapping));
      return api.post<ImportJobItem>("/imports", undefined, { formData });
    },
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all });
      // Importing creates leads — refresh anything that counts them.
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      queryClient.setQueryData(queryKeys.imports.detail(job.id), job);
    },
  });
}

/**
 * Downloads the CSV error report for an import. The endpoint requires the
 * Authorization header, so the blob is fetched first instead of linking to it.
 */
export async function downloadImportErrors(job: ImportJobItem): Promise<void> {
  const blob = await requestBlob(`/imports/${job.id}/errors`, {
    headers: { Accept: "text/csv" },
  });
  const base = job.fileName.replace(/\.csv$/i, "") || "import";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${base}-errors.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
