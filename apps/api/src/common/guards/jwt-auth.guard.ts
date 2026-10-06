import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { RequestActor } from "@middleware/types";
import { getEnv } from "@middleware/config";
import { errors, getContext, sha256Hex } from "@middleware/shared";
import { getPrisma } from "@middleware/database";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

interface AccessTokenPayload {
  sub: string;
  email: string;
  sid?: string;
}

type AuthedRequest = Request & { actor?: RequestActor; correlationId?: string };

/**
 * Authentication guard.
 *
 * Accepts either:
 *  - `Authorization: Bearer <JWT>`       → user session (role loaded from DB
 *    so permission changes take effect immediately), or
 *  - `X-API-Key: <key>`                  → machine client (scopes).
 *
 * User and permission state is always reloaded from the database.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (isPublic) return true;

    const apiKeyHeader = request.headers["x-api-key"];
    if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
      request.actor = await this.authenticateApiKey(apiKeyHeader.trim());
      this.enrichContext(request.actor);
      return true;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw errors.unauthenticated();
    }
    const token = authorization.slice("Bearer ".length).trim();
    request.actor = await this.authenticateJwt(token, request);
    this.enrichContext(request.actor);
    return true;
  }

  private async authenticateJwt(token: string, request: AuthedRequest): Promise<RequestActor> {
    const env = getEnv();
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        issuer: env.JWT_ISSUER,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TokenExpiredError") {
        throw errors.tokenExpired();
      }
      throw errors.unauthenticated("Invalid access token.");
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user || user.status !== "ACTIVE") {
      throw errors.unauthenticated("Account is not active.");
    }
    return {
      userId: user.id,
      email: user.email,
      role: user.role.name,
      permissions: user.role.permissions,
      sessionId: payload.sid,
      actorType: "USER",
      correlationId: request.correlationId ?? "unknown",
    };
  }

  private async authenticateApiKey(rawKey: string): Promise<RequestActor> {
    const prisma = getPrisma();
    const keyHash = sha256Hex(rawKey);
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
    });
    if (!apiKey || apiKey.status !== "ACTIVE" || apiKey.revokedAt) {
      throw errors.unauthenticated("Invalid API key.");
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
      throw errors.unauthenticated("API key has expired.");
    }
    // Throttled usage tracking (fire-and-forget; never blocks the request).
    const stale = !apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60_000;
    if (stale) {
      void prisma.apiKey
        .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
        .catch((err: unknown) => this.logger.warn(`Failed to update apiKey.lastUsedAt: ${String(err)}`));
    }

    return {
      userId: apiKey.userId,
      email: "",
      role: "api-key",
      permissions: apiKey.scopes.length > 0 ? apiKey.scopes : ["*"],
      actorType: "API_KEY",
      apiKeyId: apiKey.id,
      correlationId: "unknown",
    };
  }

  /** Enriches the ambient ALS context so services/logs see the actor. */
  private enrichContext(actor: RequestActor): void {
    const ctx = getContext();
    if (ctx) {
      ctx.userId = actor.userId;
      ctx.actorType = actor.actorType;
      ctx.apiKeyId = actor.apiKeyId;
    }
  }
}
