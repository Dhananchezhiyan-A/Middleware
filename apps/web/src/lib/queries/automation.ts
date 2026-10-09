import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
import type {
  DedupConfig,
  DestinationItem,
  EnrichmentStatus,
  FieldMappingDetail,
  FieldMappingListItem,
  FieldMappingVersion,
  RoutingPreview,
  RoutingPreviewInput,
  RoutingRule,
  RoutingRuleConditions,
  ScoringRuleSet,
} from "@/lib/types";

/* ------------------------------ routing rules ------------------------------ */

export function useRoutingRules() {
  return useQuery({
    queryKey: queryKeys.routing.list,
    // GET /routing-rules returns a bare array ordered by priority.
    queryFn: () => api.get<RoutingRule[]>("/routing-rules"),
  });
}

function useInvalidateRouting() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.routing.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
  };
}

export interface RoutingRuleBody {
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  stopOnMatch: boolean;
  /** Legacy flat array or the structured source/date/time/month/day shape. */
  conditions: RoutingRuleConditions;
  destinationIds: string[];
}

export function useCreateRoutingRule() {
  const invalidate = useInvalidateRouting();
  return useMutation({
    mutationFn: (body: RoutingRuleBody) => api.post<RoutingRule>("/routing-rules", body),
    onSuccess: invalidate,
  });
}

export function useUpdateRoutingRule() {
  const invalidate = useInvalidateRouting();
  return useMutation({
    mutationFn: ({ id, ...body }: RoutingRuleBody & { id: string }) =>
      api.patch<RoutingRule>(`/routing-rules/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteRoutingRule() {
  const invalidate = useInvalidateRouting();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/routing-rules/${id}`),
    onSuccess: invalidate,
  });
}

/**
 * Destinations selectable as routing targets. Reuses the destinations list
 * query (same cache key) so the picker and the destinations page never disagree.
 */
export function useDestinationsForRules() {
  return useQuery({
    queryKey: queryKeys.destinations.list,
    queryFn: () => api.get<DestinationItem[]>("/destinations"),
  });
}

/** PATCH /routing-rules/:id — enable/disable only (bumps the rule version). */
export function useSetRoutingRuleEnabled() {
  const invalidate = useInvalidateRouting();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<RoutingRule>(`/routing-rules/${id}`, { enabled }),
    onSuccess: invalidate,
  });
}

export type RoutingPreviewBody = RoutingPreviewInput;

/**
 * POST /routing-rules/preview — dry run against a sample lead. Never touches
 * the database: no RoutingResult, no delivery, no queue entry.
 */
export function usePreviewRouting() {
  return useMutation({
    mutationFn: (body: RoutingPreviewBody) => api.post<RoutingPreview>("/routing-rules/preview", body),
  });
}

/* ------------------------------ field mappings ----------------------------- */

export function useFieldMappings(destinationId?: string) {
  const params = { destinationId };
  return useQuery({
    queryKey: queryKeys.mappings.list(params),
    queryFn: () =>
      api
        .get<{ items: FieldMappingListItem[] }>("/field-mappings", {
          query: { destinationId },
        })
        .then((d) => d.items),
  });
}

export function useFieldMapping(id: string) {
  return useQuery({
    queryKey: queryKeys.mappings.detail(id),
    enabled: Boolean(id),
    queryFn: () => api.get<FieldMappingDetail>(`/field-mappings/${id}`),
  });
}

function useInvalidateMappings() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.mappings.all });
  };
}

export function useCreateFieldMapping() {
  const invalidate = useInvalidateMappings();
  return useMutation({
    mutationFn: (body: {
      destinationId: string;
      name: string;
      fields: FieldMappingVersion["fields"];
      notes?: string;
      activate?: boolean;
    }) => api.post<FieldMappingDetail>("/field-mappings", body),
    onSuccess: invalidate,
  });
}

export function useCreateFieldMappingVersion() {
  const invalidate = useInvalidateMappings();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      fields: FieldMappingVersion["fields"];
      notes?: string;
      activate?: boolean;
    }) => api.post<FieldMappingDetail>(`/field-mappings/${id}/versions`, body),
    onSuccess: invalidate,
  });
}

export function useActivateFieldMappingVersion() {
  const invalidate = useInvalidateMappings();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<{ activated: boolean }>(`/field-mappings/${id}/activate`, { version }),
    onSuccess: invalidate,
  });
}

export function useDeleteFieldMapping() {
  const invalidate = useInvalidateMappings();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/field-mappings/${id}`),
    onSuccess: invalidate,
  });
}

/* --------------------------------- scoring --------------------------------- */

export function useScoring() {
  return useQuery({
    queryKey: queryKeys.automation.scoring,
    // GET /automation/scoring returns a bare array of immutable versions.
    queryFn: () => api.get<ScoringRuleSet[]>("/automation/scoring"),
  });
}

export function useCreateScoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      enabled?: boolean;
      rules: ScoringRuleSet["rules"];
    }) => api.post<ScoringRuleSet>("/automation/scoring", body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.automation.scoring }),
  });
}

export function useToggleScoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<ScoringRuleSet>(`/automation/scoring/${id}`, { enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.automation.scoring }),
  });
}

/* ------------------------------ deduplication ------------------------------ */

export function useDedup() {
  return useQuery({
    queryKey: queryKeys.automation.dedup,
    queryFn: () => api.get<DedupConfig>("/automation/dedup"),
  });
}

export function useSaveDedup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { enabled: boolean; strategy: string; matchFields: string[] }) =>
      api.put<DedupConfig>("/automation/dedup", body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.automation.dedup }),
  });
}

/* -------------------------------- enrichment ------------------------------- */

export function useEnrichment() {
  return useQuery({
    queryKey: queryKeys.automation.enrichment,
    queryFn: () => api.get<EnrichmentStatus>("/automation/enrichment"),
  });
}
