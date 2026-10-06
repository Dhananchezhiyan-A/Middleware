/**
 * Shared API transport types (cursor pagination, actor context, …).
 */

export interface CursorPage<T> {
  items: T[];
  /** Cursor for the next page; null when exhausted. */
  nextCursor: string | null;
  /** Total matching rows when cheaply computable (small/filtered sets). */
  total?: number;
}

export interface CursorQuery {
  cursor?: string | null;
  limit?: number;
}

/** Authenticated request actor — derived from the JWT, never from the body. */
export interface RequestActor {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  sessionId?: string;
  actorType: "USER" | "API_KEY";
  apiKeyId?: string;
  correlationId: string;
}
