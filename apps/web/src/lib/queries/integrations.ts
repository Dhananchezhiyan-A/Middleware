import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
import type { DestinationItem, DestinationTestResult, DestinationTypeInfo, SourceAccount, SourceItem } from "@/lib/types";

/* --------------------------------- sources --------------------------------- */

export function useSources() {
  return useQuery({
    queryKey: queryKeys.sources.list,
    // GET /sources returns a bare array (Prisma findMany with _count).
    queryFn: () => api.get<SourceItem[]>("/sources"),
  });
}

export function useSourceAccounts(sourceId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.sources.accounts(sourceId ?? ""),
    enabled: Boolean(sourceId) && enabled,
    // GET /sources/:id/accounts returns a bare array; the server appends webhookUrl.
    queryFn: () => api.get<SourceAccount[]>(`/sources/${sourceId}/accounts`),
  });
}

function useInvalidateSources() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sources.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
  };
}

export function useCreateSource() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (body: { type: string; code: string; name: string; config?: Record<string, unknown> }) =>
      api.post<SourceItem>("/sources", body),
    onSuccess: invalidate,
  });
}

export function useUpdateSource() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; config?: Record<string, unknown> }) =>
      api.patch<SourceItem>(`/sources/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteSource() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/sources/${id}`),
    onSuccess: invalidate,
  });
}

export function useCreateSourceAccount() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: ({ sourceId, ...body }: { sourceId: string; name: string; config?: Record<string, unknown> }) =>
      api.post<SourceAccount>(`/sources/${sourceId}/accounts`, body),
    onSuccess: invalidate,
  });
}

export function useUpdateSourceAccount() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: ({
      accountId,
      ...body
    }: {
      accountId: string;
      name?: string;
      config?: Record<string, unknown>;
    }) => api.patch<SourceAccount>(`/sources/accounts/${accountId}`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteSourceAccount() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (accountId: string) => api.delete<{ deleted: boolean }>(`/sources/accounts/${accountId}`),
    onSuccess: invalidate,
  });
}

/** POST /sources/accounts/:accountId/rotate-secret — new secret returned ONCE. */
export function useRotateAccountSecret() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (accountId: string) =>
      api.post<{ signingSecret: string }>(`/sources/accounts/${accountId}/rotate-secret`),
    onSuccess: invalidate,
  });
}

/* ------------------------------- destinations ------------------------------ */

export function useDestinations() {
  return useQuery({
    queryKey: queryKeys.destinations.list,
    // GET /destinations returns a bare array (health + _count included).
    queryFn: () => api.get<DestinationItem[]>("/destinations"),
  });
}

/** GET /destinations/types — adapter-declared required config keys (bare array). */
export function useDestinationTypes() {
  return useQuery({
    queryKey: queryKeys.destinations.types,
    queryFn: () => api.get<DestinationTypeInfo[]>("/destinations/types"),
  });
}

export interface DestinationCredentialMeta {
  id: string;
  type: string;
  meta?: Record<string, unknown> | null;
  createdAt?: string;
  rotatedAt?: string | null;
}

/** GET /destinations/:id — includes credential METADATA only (never the secret). */
export function useDestinationDetail(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.destinations.detail(id ?? ""),
    enabled: Boolean(id) && enabled,
    queryFn: () =>
      api.get<DestinationItem & { credential: DestinationCredentialMeta | null }>(
        `/destinations/${id}`,
      ),
  });
}

function useInvalidateDestinations() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.destinations.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    void queryClient.invalidateQueries({ queryKey: queryKeys.mappings.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.routing.all });
  };
}

export function useCreateDestination() {
  const invalidate = useInvalidateDestinations();
  return useMutation({
    mutationFn: (body: {
      type: string;
      name: string;
      config?: Record<string, unknown>;
      rateLimitPerSec?: number;
    }) => api.post<DestinationItem>("/destinations", body),
    onSuccess: invalidate,
  });
}

export function useUpdateDestination() {
  const invalidate = useInvalidateDestinations();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      status?: "ACTIVE" | "DISABLED";
      config?: Record<string, unknown>;
      rateLimitPerSec?: number | null;
    }) => api.patch<DestinationItem>(`/destinations/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteDestination() {
  const invalidate = useInvalidateDestinations();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/destinations/${id}`),
    onSuccess: invalidate,
  });
}

/** PUT /destinations/:id/credential — secrets are write-only, never returned. */
export function useSetDestinationCredentials() {
  return useMutation({
    mutationFn: ({
      id,
      type,
      secret,
      meta,
    }: {
      id: string;
      type: string;
      secret: string;
      meta?: Record<string, unknown>;
    }) =>
      api.put<{ stored: boolean; type: string }>(`/destinations/${id}/credential`, {
        type,
        secret,
        ...(meta ? { meta } : {}),
      }),
  });
}

/** DELETE /destinations/:id/credential — drops the stored secret. */
export function useRemoveDestinationCredential() {
  return useMutation({
    mutationFn: (id: string) => api.delete<{ removed: boolean }>(`/destinations/${id}/credential`),
  });
}

/** POST /destinations/:id/test — real connectivity check. */
export function useTestDestination() {
  return useMutation({
    mutationFn: (id: string) => api.post<DestinationTestResult>(`/destinations/${id}/test`),
  });
}
