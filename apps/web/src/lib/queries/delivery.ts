import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeliveryStatus } from "@middleware/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
import type { DeliveryDetail, DeliveryListPage, QueueStats } from "@/lib/types";

export interface DeliveryListParams {
  status?: DeliveryStatus;
  destinationId?: string;
  leadId?: string;
  limit?: number;
}

export function useDeliveryList(params: DeliveryListParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.deliveries.list(params),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<DeliveryListPage>("/deliveries", {
        query: {
          status: params.status,
          destinationId: params.destinationId,
          leadId: params.leadId,
          limit: params.limit ?? 25,
          cursor: pageParam,
        },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function deliveryRows(pages: { pages: DeliveryListPage[] } | undefined) {
  return pages?.pages.flatMap((page) => page.items) ?? [];
}

export function useDelivery(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.deliveries.detail(id),
    enabled: Boolean(id) && enabled,
    queryFn: () => api.get<DeliveryDetail>(`/deliveries/${id}`),
  });
}

/** POST /deliveries/:id/replay — perm: deliveries:retry */
export function useReplayDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ queued: boolean }>(`/deliveries/${id}/replay`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

/** GET /deliveries/queue-stats — live BullMQ + Redis health. */
export function useQueueStats() {
  return useQuery({
    queryKey: queryKeys.deliveries.queueStats,
    queryFn: () => api.get<QueueStats>("/deliveries/queue-stats"),
    refetchInterval: 30_000,
  });
}

/**
 * A raw BullMQ job row as reported by the API. Failed/dead-letter endpoints
 * return either a job object or a single `{ error }` entry when Redis is down —
 * both are rendered verbatim, never converted into zeros.
 */
export interface QueueJob {
  id?: string;
  name?: string;
  queue?: string;
  data?: Record<string, unknown>;
  failedReason?: string | null;
  attemptsMade?: number;
  createdAt?: string | null;
  processedOn?: string | null;
  retryAt?: string | null;
  error?: string;
}

export function useFailedJobs(queue: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.deliveries.failed(queue),
    enabled: enabled && Boolean(queue),
    queryFn: () =>
      api.get<QueueJob[]>("/deliveries/failed", { query: { queue, limit: 50 } }),
    refetchInterval: 30_000,
  });
}

export function useDeadLetterJobs(queue: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.deliveries.deadLetter(queue),
    enabled: enabled && Boolean(queue),
    queryFn: () =>
      api.get<QueueJob[]>("/deliveries/dead-letter", { query: { queue, limit: 50 } }),
    refetchInterval: 30_000,
  });
}
