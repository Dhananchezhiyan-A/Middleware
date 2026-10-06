/**
 * Permission catalog and role templates.
 *
 * Authorization model:
 *   User → Role → permissions[] → effective access
 *
 * Permission codes are checked SERVER-SIDE on every protected endpoint.
 * Hiding UI buttons is never treated as security.
 */

export const PERMISSIONS = [
  // Leads
  "leads:read",
  "leads:write",
  "leads:replay",
  "leads:delete",
  // Sources
  "sources:read",
  "sources:write",
  // Destinations
  "destinations:read",
  "destinations:write",
  "destinations:test",
  // Automation
  "routing:read",
  "routing:write",
  "mappings:read",
  "mappings:write",
  "scoring:read",
  "scoring:write",
  "dedup:read",
  "dedup:write",
  "enrichment:read",
  "enrichment:write",
  // Delivery
  "deliveries:read",
  "deliveries:retry",
  // Imports
  "imports:read",
  "imports:write",
  // Analytics
  "analytics:read",
  // System
  "users:read",
  "users:write",
  "roles:read",
  "roles:write",
  "apikeys:read",
  "apikeys:write",
  "audit:read",
  "settings:read",
  "settings:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  DEVELOPER: "developer",
  VIEWER: "viewer",
} as const;
export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

const READ_ONLY: Permission[] = PERMISSIONS.filter((p) => p.endsWith(":read"));

/** System role templates. */
export const ROLE_TEMPLATES: Record<
  SystemRoleName,
  { description: string; permissions: Permission[] }
> = {
  admin: {
    description: "Full access to every feature, including users, roles and settings.",
    permissions: [...PERMISSIONS],
  },
  manager: {
    description: "Day-to-day operations: leads, routing, mappings, deliveries, analytics.",
    permissions: PERMISSIONS.filter(
      (p) =>
        p.endsWith(":read") ||
        p === "leads:write" ||
        p === "leads:replay" ||
        p === "sources:write" ||
        p === "destinations:write" ||
        p === "routing:write" ||
        p === "mappings:write" ||
        p === "scoring:write" ||
        p === "dedup:write" ||
        p === "deliveries:retry" ||
        p === "imports:write",
    ),
  },
  developer: {
    description: "Integration focus: sources, destinations, mappings, API keys, deliveries.",
    permissions: PERMISSIONS.filter(
      (p) =>
        p.endsWith(":read") ||
        p === "sources:write" ||
        p === "destinations:write" ||
        p === "mappings:write" ||
        p === "routing:write" ||
        p === "apikeys:write" ||
        p === "deliveries:retry" ||
        p === "imports:write" ||
        p === "leads:replay",
    ),
  },
  viewer: {
    description: "Read-only access. Cannot modify anything.",
    permissions: READ_ONLY,
  },
};
