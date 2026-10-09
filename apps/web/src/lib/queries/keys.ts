/**
 * Central query-key factory.
 *
 * Every cache entry is addressable by a stable key so mutations can invalidate
 * exactly what they affect.
 */

export const queryKeys = {
  dashboard: ["analytics", "dashboard"] as const,
  health: ["system", "health"] as const,

  leads: {
    all: ["leads"] as const,
    list: (params: unknown) => ["leads", "list", params] as const,
    detail: (id: string) => ["leads", "detail", id] as const,
    audit: (id: string) => ["leads", "audit", id] as const,
  },

  sources: {
    all: ["sources"] as const,
    list: ["sources", "list"] as const,
    accounts: (sourceId: string) => ["sources", "accounts", sourceId] as const,
    /** GET /webhooks/events — inbound event log (drill-down from the dashboard). */
    events: (params: unknown) => ["sources", "events", params] as const,
  },

  destinations: {
    all: ["destinations"] as const,
    list: ["destinations", "list"] as const,
    types: ["destinations", "types"] as const,
    detail: (id: string) => ["destinations", "detail", id] as const,
  },

  routing: {
    all: ["routing-rules"] as const,
    list: ["routing-rules", "list"] as const,
  },

  mappings: {
    all: ["field-mappings"] as const,
    list: (params: unknown) => ["field-mappings", "list", params] as const,
    detail: (id: string) => ["field-mappings", "detail", id] as const,
  },

  automation: {
    scoring: ["automation", "scoring"] as const,
    dedup: ["automation", "dedup"] as const,
    enrichment: ["automation", "enrichment"] as const,
  },

  deliveries: {
    all: ["deliveries"] as const,
    list: (params: unknown) => ["deliveries", "list", params] as const,
    detail: (id: string) => ["deliveries", "detail", id] as const,
    queueStats: ["deliveries", "queue-stats"] as const,
    failed: (queue: string) => ["deliveries", "failed", queue] as const,
    deadLetter: (queue: string) => ["deliveries", "dead-letter", queue] as const,
  },

  auditLogs: (params: unknown) => ["audit-logs", params] as const,
  users: ["users"] as const,
  roles: {
    all: ["roles"] as const,
    list: ["roles", "list"] as const,
    permissions: ["roles", "permissions"] as const,
  },
  apiKeys: ["api-keys"] as const,
} as const;
