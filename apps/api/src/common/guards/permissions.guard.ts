import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission, RequestActor } from "@middleware/types";
import { errors } from "@middleware/shared";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * Server-side authorization: User → Role → permissions → effective access.
 * Frontend visibility is never treated as security.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || !required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ actor?: RequestActor }>();
    const actor = request.actor;
    if (!actor) throw errors.unauthenticated();

    // "*" = full access (API keys without scopes / admin template).
    if (actor.permissions.includes("*")) return true;

    const missing = required.filter((p) => !actor.permissions.includes(p));
    if (missing.length > 0) {
      throw errors.forbidden(`Missing permission: ${missing.join(", ")}`);
    }
    return true;
  }
}
