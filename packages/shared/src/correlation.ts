import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AuditActorType } from "@middleware/types";

/**
 * Correlation & ambient request context.
 *
 * One correlationId follows a lead through:
 *   HTTP request → intake job → pipeline stages → delivery jobs → CRM call
 * so any lead can be traced end-to-end in logs and the UI.
 */

export interface RequestContext {
  correlationId: string;
  userId?: string;
  actorType: AuditActorType;
  apiKeyId?: string;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function newCorrelationId(): string {
  return randomUUID();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string {
  return storage.getStore()?.correlationId ?? "unknown";
}

