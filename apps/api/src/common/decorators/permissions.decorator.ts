import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@middleware/types";

export const PERMISSIONS_KEY = "requiredPermissions";

/**
 * Server-side permission requirement for a route.
 * Checked by PermissionsGuard against the actor's ROLE permissions —
 * never against anything supplied by the client.
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
