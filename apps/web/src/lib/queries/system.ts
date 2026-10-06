import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";
import type {
  ApiKeyCreated,
  ApiKeyListItem,
  AuditLogItem,
  RoleListItem,
  RolePermissionsResult,
  UserListItem,
} from "@/lib/types";

/* ---------------------------------- users ---------------------------------- */

export function useUsers() {
  return useInfiniteQuery({
    queryKey: queryKeys.users,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<{ items: UserListItem[]; nextCursor?: string | null }>("/users", {
        query: { cursor: pageParam, limit: 25 },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function userRows(pages: { pages: { items: UserListItem[] }[] } | undefined) {
  return pages?.pages.flatMap((page) => page.items) ?? [];
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; name: string; password: string; roleId: string }) =>
      api.post<UserListItem>("/users", body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string; name?: string; roleId?: string; status?: string }) =>
      api.patch<UserListItem>(`/users/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

/* ---------------------------------- roles ---------------------------------- */

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles.list,
    // GET /roles returns a bare array of RoleListItem (incl. userCount).
    queryFn: () => api.get<RoleListItem[]>("/roles"),
  });
}

export function useRolePermissions() {
  return useQuery({
    queryKey: queryKeys.roles.permissions,
    queryFn: () => api.get<RolePermissionsResult>("/roles/permissions"),
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string; permissions: string[] }) =>
      api.post<RoleListItem>("/roles", body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all }),
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string; name?: string; description?: string; permissions?: string[] }) =>
      api.patch<RoleListItem>(`/roles/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all }),
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/roles/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all }),
  });
}

/* --------------------------------- api keys -------------------------------- */

export function useApiKeys() {
  return useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: () => api.get<{ items: ApiKeyListItem[] }>("/api-keys").then((d) => d.items),
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; scopes?: string[]; expiresInDays?: number }) =>
      api.post<ApiKeyCreated>("/api-keys", body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ revoked: boolean }>(`/api-keys/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys }),
  });
}

/* -------------------------------- audit logs ------------------------------- */

export interface AuditLogParams {
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function useAuditLogs(params: AuditLogParams) {
  return useInfiniteQuery({
    queryKey: queryKeys.auditLogs(params),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<{ items: AuditLogItem[]; nextCursor?: string | null }>("/audit-logs", {
        query: {
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          from: params.from,
          to: params.to,
          limit: params.limit ?? 25,
          cursor: pageParam,
        },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function auditRows(pages: { pages: { items: AuditLogItem[] }[] } | undefined) {
  return pages?.pages.flatMap((page) => page.items) ?? [];
}
