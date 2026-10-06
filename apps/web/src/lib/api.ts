/**
 * Typed fetch client for the Lead Integration & Distribution Middleware API.
 *
 * Contract:
 *  - Base URL comes from NEXT_PUBLIC_API_URL (default http://localhost:4000).
 *  - Every route lives under /api/v1 and every JSON response is enveloped:
 *      success → { success: true,  data: T, meta? }
 *      error   → { success: false, error: { code, message, requestId, details? } }
 *  - The access token is kept IN MEMORY only (module-level variable). The
 *    refresh token lives in an httpOnly cookie scoped to /api/v1/auth, so on page
 *    load we POST /auth/refresh (credentials: 'include') to mint a fresh access
 *    token without ever persisting credentials in browser storage.
 *  - A 401 on any request triggers ONE refresh (single-flight: concurrent 401s
 *    share the same refresh promise) and one retry. If refresh fails, the
 *    unauthenticated handler is invoked so the auth store can redirect to /login.
 */

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
  /\/+$/,
  "",
);
export const API_PREFIX = "/api/v1";

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export class ApiError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(init: {
    code: string;
    message: string;
    requestId?: string;
    status?: number;
    details?: unknown;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.requestId = init.requestId ?? "";
    this.status = init.status ?? 0;
    this.details = init.details;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401 || this.code === "UNAUTHENTICATED" || this.code === "TOKEN_EXPIRED";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: QueryParams;
  /** JSON body (ignored when `formData` is provided). */
  body?: unknown;
  /** Multipart body — content-type is set by the browser. */
  formData?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Send the Authorization header (default true). */
  auth?: boolean;
  /** Attempt a refresh + retry on 401 (default true). */
  retryOn401?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Token store (memory only)                                                   */
/* -------------------------------------------------------------------------- */

let accessToken: string | null = null;
let unauthenticatedHandler: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Registered by the auth store so a failed refresh can trigger a /login redirect. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  unauthenticatedHandler = handler;
}

function notifyUnauthenticated(): void {
  accessToken = null;
  unauthenticatedHandler?.();
}

/* -------------------------------------------------------------------------- */
/* URL helpers                                                                 */
/* -------------------------------------------------------------------------- */

/** Absolute API URL for a path such as `/leads`. */
export function buildUrl(path: string, query?: QueryParams): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${API_PREFIX}${normalizedPath}`, `${API_BASE_URL}/`);
  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

/** Public webhook intake URL for a source account public id. */
export function webhookUrl(publicId: string): string {
  return buildUrl(`/webhooks/inbound/${publicId}`);
}

/* -------------------------------------------------------------------------- */
/* Refresh (single-flight)                                                     */
/* -------------------------------------------------------------------------- */

let refreshInFlight: Promise<boolean> | null = null;

export function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    if (!res.ok) return false;
    const body: unknown = await res.json().catch(() => null);
    const token = readAccessToken(body);
    if (!token) return false;
    accessToken = token;
    return true;
  } catch {
    return false;
  }
}

function readAccessToken(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { success?: unknown; data?: { accessToken?: unknown } };
  if (record.success === true && record.data && typeof record.data.accessToken === "string") {
    return record.data.accessToken;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Core request                                                                */
/* -------------------------------------------------------------------------- */

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };

  if (opts.auth !== false && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (!BODYLESS_METHODS.has(method)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body ?? {});
  }

  return fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body,
    credentials: "include",
    signal: opts.signal,
  });
}

function isAuthPath(path: string): boolean {
  return path.startsWith("/auth/");
}

async function errorFromResponse(res: Response, path: string): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (payload && typeof payload === "object") {
    const record = payload as {
      success?: unknown;
      error?: { code?: unknown; message?: unknown; requestId?: unknown; details?: unknown };
    };
    if (record.success === false && record.error) {
      return new ApiError({
        code: typeof record.error.code === "string" ? record.error.code : "UNKNOWN",
        message:
          typeof record.error.message === "string" ? record.error.message : "Request failed.",
        requestId: typeof record.error.requestId === "string" ? record.error.requestId : "",
        status: res.status,
        details: record.error.details,
      });
    }
  }

  return new ApiError({
    code: httpErrorCode(res.status),
    message: `Request to ${path} failed with status ${res.status}.`,
    status: res.status,
  });
}

function httpErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 422:
      return "VALIDATION_FAILED";
    case 429:
      return "RATE_LIMITED";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN";
  }
}

/**
 * Perform a request and unwrap the `data` envelope.
 * Throws {@link ApiError} on any failure.
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const canRetry =
    opts.retryOn401 !== false && opts.auth !== false && !isAuthPath(path);

  let res: Response;
  try {
    res = await send(path, opts);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError({
      code: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Network request failed.",
      status: 0,
    });
  }

  if (res.status === 401 && canRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        res = await send(path, opts);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        throw new ApiError({
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Network request failed.",
          status: 0,
        });
      }
    }
  }

  if (res.status === 401 && canRetry && !(await hasSuccessEnvelope(res.clone()))) {
    notifyUnauthenticated();
  }

  if (!res.ok) {
    throw await errorFromResponse(res, path);
  }

  const payload: unknown = await res.json().catch(() => null);
  if (payload && typeof payload === "object" && "success" in payload) {
    const record = payload as { success: boolean; data?: unknown; error?: unknown };
    if (record.success === false) {
      const error = await errorFromResponse(res.clone(), path);
      throw error;
    }
    return record.data as T;
  }

  // Unenveloped 2xx (should not happen for JSON routes) — return as-is.
  return payload as T;
}

async function hasSuccessEnvelope(res: Response): Promise<boolean> {
  try {
    const payload: unknown = await res.json();
    return Boolean(payload && typeof payload === "object" && (payload as { success?: unknown }).success === true);
  } catch {
    return false;
  }
}

/** Request a binary payload (e.g. CSV error reports) with the usual auth rules. */
export async function requestBlob(path: string, opts: RequestOptions = {}): Promise<Blob> {
  const canRetry = opts.retryOn401 !== false && opts.auth !== false && !isAuthPath(path);
  let res = await send(path, opts).catch((err: unknown) => {
    throw new ApiError({
      code: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Network request failed.",
      status: 0,
    });
  });

  if (res.status === 401 && canRetry && (await refreshAccessToken())) {
    res = await send(path, opts);
  }
  if (!res.ok) throw await errorFromResponse(res, path);
  return res.blob();
}

/* -------------------------------------------------------------------------- */
/* Verb helpers                                                                */
/* -------------------------------------------------------------------------- */

export const api = {
  get: <T>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> =>
    request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "method"> = {}): Promise<T> =>
    request<T>(path, { ...opts, method: "POST", body }),
  put: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "method"> = {}): Promise<T> =>
    request<T>(path, { ...opts, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "method"> = {}): Promise<T> =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts: Omit<RequestOptions, "method"> = {}): Promise<T> =>
    request<T>(path, { ...opts, method: "DELETE" }),
};

/** Human-friendly message from any thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
