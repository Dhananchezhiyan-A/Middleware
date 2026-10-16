import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeadStatus } from "@middleware/types";
import type { QuickRange } from "@middleware/validation";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
import type {
  DeliveryStats,
  LeadAuditEntry,
  LeadDetail,
  LeadListPage,
  LeadSelectionToken,
  ManualSendPreview,
  ManualSendResult,
} from "@/lib/types";
import type { SelectionOnlyPayload } from "@/lib/selection";

export interface LeadListParams {
  status?: LeadStatus;
  sourceId?: string;
  from?: string;
  to?: string;
  q?: string;
  /** Server-interpreted calendar filters (APP_TIMEZONE). */
  dateFrom?: string;
  timeFrom?: string;
  dateTo?: string;
  timeTo?: string;
  quickRange?: QuickRange;
  sort?: "receivedAt:asc" | "receivedAt:desc";
  limit?: number;
}

/** Cursor-paginated lead list. */
export function useLeadList(params: LeadListParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.leads.list(params),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<LeadListPage>("/leads", {
        query: {
          status: params.status,
          sourceId: params.sourceId,
          from: params.from,
          to: params.to,
          q: params.q,
          dateFrom: params.dateFrom,
          timeFrom: params.timeFrom,
          dateTo: params.dateTo,
          timeTo: params.timeTo,
          quickRange: params.quickRange,
          sort: params.sort,
          limit: params.limit ?? 25,
          cursor: pageParam,
        },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function leadRows(pages: { pages: LeadListPage[] } | undefined) {
  return pages?.pages.flatMap((page) => page.items) ?? [];
}

interface LeadDetailResponse {
  id: string;
  leadId: string;
  externalLeadId?: string | null;
  status: string;
  stage: string;
  score?: number | null;
  scoreVersion?: string | null;
  source: { id: string; type: string; name: string; code?: string };
  sourceAccount?: { id: string; name: string; publicId: string } | null;
  canonicalData: LeadDetail["canonicalData"];
  normalizedData?: unknown;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
  correlationId?: string | null;
  processing: LeadDetail["processing"];
  scores: LeadDetail["scores"];
  duplicateOf: LeadDetail["duplicateOf"];
  deliveries: LeadDetail["deliveries"];
}

interface TimelineResponse {
  stageEvents: LeadDetail["stageEvents"];
  scores: LeadDetail["scores"];
  routingResults: LeadDetail["routingResults"];
}

interface PayloadsResponse {
  canonical: unknown;
  normalized: unknown;
  payloads: LeadDetail["rawPayloads"];
}

/**
 * GET /leads/:id + /timeline + /payloads composed into one view model.
 * The API intentionally exposes the lead row, the pipeline timeline and the
 * raw payloads as separate routes; the detail page needs all three.
 */
export function useLead(id: string) {
  return useQuery({
    queryKey: queryKeys.leads.detail(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<LeadDetail> => {
      const [lead, timeline, payloads] = await Promise.all([
        api.get<LeadDetailResponse>(`/leads/${id}`),
        api.get<TimelineResponse>(`/leads/${id}/timeline`),
        api.get<PayloadsResponse>(`/leads/${id}/payloads`),
      ]);
      return {
        ...lead,
        status: lead.status as LeadDetail["status"],
        stage: lead.stage as LeadDetail["stage"],
        stageEvents: timeline.stageEvents,
        routingResults: timeline.routingResults,
        // Prefer the timeline copy (it is ordered ascending for the pipeline view).
        scores: timeline.scores.length > 0 ? timeline.scores : lead.scores,
        rawPayloads: payloads.payloads,
        normalizedData: payloads.normalized ?? lead.normalizedData,
      };
    },
  });
}

/**
 * Audit history for a lead — served by the application-wide audit log filtered
 * on `entityId` (there is no dedicated /leads/:id/audit route).
 */
export function useLeadAudit(id: string) {
  return useQuery({
    queryKey: queryKeys.leads.audit(id),
    enabled: Boolean(id),
    queryFn: () =>
      api
        .get<{ items: LeadAuditEntry[] }>("/audit-logs", {
          query: { entityId: id, limit: 50 },
        })
        .then((d) => d.items),
  });
}

/** POST /leads/:id/replay — perm: leads:replay */
export function useReplayLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ queued: boolean }>(`/leads/${id}/replay`),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

/** POST /leads — perm: leads:write */
export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { sourceId: string; sourceAccountId?: string; externalLeadId?: string; payload: unknown }) =>
      api.post<{ id: string; status: string }>("/leads", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

/* ------------------------- manual lead delivery ---------------------------- */

/**
 * POST /leads/selection — perm: leads:read. Resolves EVERY lead matching the
 * filters into an expiring server-side snapshot; the browser only gets a
 * token + count (off-page lead IDs never leave the server).
 */
export function useCreateSelection() {
  return useMutation({
    mutationFn: (filters: LeadListParams) => api.post<LeadSelectionToken>("/leads/selection", filters),
  });
}

export type ManualSendPayload = SelectionOnlyPayload & { destinationIds: string[] };

/** POST /leads/manual-send/preview — perm: leads:replay. */
export function useSendPreview() {
  return useMutation({
    mutationFn: (body: ManualSendPayload) => api.post<ManualSendPreview>("/leads/manual-send/preview", body),
  });
}

/** POST /leads/manual-send — perm: leads:replay. Queues deliveries; never delivers inline. */
export function useManualSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualSendPayload) => api.post<ManualSendResult>("/leads/manual-send", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

/**
 * GET /deliveries/stats?correlationId= — perm: deliveries:read.
 * `refetchInterval` is controlled by the caller (2s while the submission is
 * still moving, then stopped so an idle panel never polls).
 */
export function useDeliveryStats(
  correlationId: string | null,
  refetchInterval: number | false | ((query: unknown) => number | false | undefined),
) {
  return useQuery({
    queryKey: queryKeys.deliveries.stats(correlationId ?? ""),
    enabled: Boolean(correlationId),
    refetchInterval,
    queryFn: () =>
      api.get<DeliveryStats>("/deliveries/stats", { query: { correlationId: correlationId ?? "" } }),
  });
}
