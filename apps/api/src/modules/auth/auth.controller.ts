import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { getEnv } from "@middleware/config";
import { errors } from "@middleware/shared";
import { getPrisma } from "@middleware/database";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { RequestActor } from "@middleware/types";
import { AuthService, REFRESH_COOKIE, type AuthResult } from "./auth.service";
import { LoginDto, RefreshDto } from "./auth.dtos";

const env = getEnv();

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthResult["user"];
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: env.AUTH_RATE_LIMIT_PER_MIN } })
  @Post("login")
  @ApiOperation({ summary: "Exchange credentials for access + refresh tokens" })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login({
      email: body.email,
      password: body.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    this.setRefreshCookie(res, result);
    return this.toResponse(result);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: env.AUTH_RATE_LIMIT_PER_MIN } })
  @Post("refresh")
  @ApiOperation({ summary: "Rotate the refresh token and mint a new access token" })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    // CSRF guard: cookie-based auth must only come from our own origins.
    const origin = req.headers.origin;
    if (origin && !env.CORS_ORIGINS.includes(origin)) {
      throw errors.forbidden("Invalid request origin.");
    }
    const token = body.refreshToken ?? this.readCookie(req, REFRESH_COOKIE);
    if (!token) throw errors.unauthenticated("A refresh token is required.");
    const result = await this.auth.refresh(token, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    this.setRefreshCookie(res, result);
    return this.toResponse(result);
  }

  @Public()
  @Post("logout")
  @ApiOperation({ summary: "Revoke the current session (refresh token rotation guard)" })
  async logout(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ revoked: boolean }> {
    const token = body.refreshToken ?? this.readCookie(req, REFRESH_COOKIE);
    let revoked = false;
    if (token) {
      const { hashToken } = await import("@middleware/shared");
      const session = await getPrisma().userSession.findUnique({
        where: { refreshTokenHash: hashToken(token) },
      });
      if (session && !session.revokedAt) {
        await this.auth.logout(session.id);
        revoked = true;
      }
    }
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    return { revoked };
  }

  @Get("me")
  @ApiOperation({ summary: "Current user, role and permissions" })
  async me(@CurrentUser() actor: RequestActor): Promise<{
    user: {
      id: string;
      email: string;
      role: string;
      permissions: string[];
      actorType: string;
    };
  }> {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        email: true,
        name: true,
        roleId: true,
        role: { select: { name: true, permissions: true } },
      },
    });
    if (!user) throw errors.notFound("User not found.");
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role.name,
        permissions: user.role.permissions,
        actorType: actor.actorType,
      },
    };
  }

  // --- helpers ---------------------------------------------------------------

  private toResponse(result: AuthResult): AuthResponse {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      refreshExpiresAt: result.refreshExpiresAt,
      user: result.user,
    };
  }

  private setRefreshCookie(res: Response, result: AuthResult): void {
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/api/v1/auth",
      maxAge: env.JWT_REFRESH_TTL * 1000,
    });
  }

  private readCookie(req: Request, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === name) return decodeURIComponent(rest.join("="));
    }
    return undefined;
  }
}
