import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { getEnv } from "@middleware/config";
import { getPrisma, Prisma } from "@middleware/database";
import { errors, hashToken, randomToken } from "@middleware/shared";
import { AuditService } from "../../infra/audit.module";

type AuthUser = Prisma.UserGetPayload<{ include: { role: true } }> | null;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: SessionUser;
  sessionId: string;
}

export const REFRESH_COOKIE = "mw_refresh";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------
  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AuthResult> {
    const prisma = getPrisma();
    const user: AuthUser = await prisma.user.findUnique({
      where: { email: input.email },
      include: { role: true },
    });

    const genericFailure = () => errors.unauthenticated("Invalid email or password.");

    if (!user) throw genericFailure();
    if (user.status !== "ACTIVE") throw genericFailure();

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      await this.auditService.record({
        action: "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        actorId: user.id,
        actorLabel: user.email,
        actorType: "USER",
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { reason: "bad_password" },
      });
      throw genericFailure();
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const result = await this.issueSession(user, user.role);

    await this.auditService.record({
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      actorId: user.id,
      actorLabel: user.email,
      actorType: "USER",
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Refresh (rotation + reuse detection)
  // -------------------------------------------------------------------------
  async refresh(
    token: string,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthResult> {
    const prisma = getPrisma();
    if (!token) throw errors.unauthenticated("Missing refresh token.");

    const session = await prisma.userSession.findUnique({
      where: { refreshTokenHash: hashToken(token) },
      include: { user: { include: { role: true } } },
    });

    if (!session) throw errors.unauthenticated("Invalid refresh token.");

    if (session.revokedAt) {
      // Token reuse after rotation → assume theft, revoke EVERYTHING.
      await prisma.userSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.auditService.record({
        action: "auth.refresh_reuse_detected",
        entityType: "User",
        entityId: session.userId,
        actorId: session.userId,
        actorLabel: session.user.email,
        actorType: "USER",
        ip: meta.ip,
        metadata: { sessionId: session.id },
      });
      this.logger.warn(`Refresh token reuse detected userId=${session.userId}`);
      throw errors.unauthenticated("Session revoked.");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw errors.tokenExpired();
    }

    const user = session.user;
    if (user.status !== "ACTIVE") {
      throw errors.unauthenticated("Account is not active.");
    }

    // Rotate: revoke the used session, issue a brand-new one.
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueSession(user, user.role);
  }

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------
  async logout(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    await getPrisma()
      .userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch((err: unknown) => this.logger.warn(`logout revoke failed: ${String(err)}`));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private async issueSession(
    user: { id: string; email: string; name: string },
    role: { name: string; permissions: string[] },
  ): Promise<AuthResult> {
    const env = getEnv();
    const prisma = getPrisma();

    const refreshToken = randomToken(48);
    const refreshExpiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL * 1000);

    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, sid: session.id },
      { issuer: env.JWT_ISSUER, expiresIn: env.JWT_ACCESS_TTL },
    );

    return {
      accessToken,
      refreshToken,
      refreshExpiresAt,
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: role.name,
        permissions: role.permissions,
      },
    };
  }
}
