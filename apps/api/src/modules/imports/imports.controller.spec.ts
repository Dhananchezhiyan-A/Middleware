import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RequestActor } from "@middleware/types";
import { PERMISSIONS_KEY } from "../../common/decorators/permissions.decorator";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { ImportsController } from "./imports.controller";

/**
 * Authorization for the import endpoints is enforced by PermissionsGuard from
 * the metadata on each handler — the browser only hides what the API refuses.
 * These tests pin the metadata AND prove the guard denies a session that is
 * missing the permission (the "unauthorized import attempt" case).
 */

const READ_METHODS = ["list", "get", "rowErrors", "downloadErrors"] as const;

const ACTOR: RequestActor = {
  userId: "user_1",
  email: "owner@demo.dev",
  role: "Owner",
  permissions: ["imports:read", "imports:write"],
  sessionId: "session_1",
  actorType: "USER",
  correlationId: "corr_1",
};

function contextFor(method: (...args: never[]) => unknown, actor?: RequestActor): ExecutionContext {
  return {
    getHandler: () => method,
    getClass: () => ImportsController,
    switchToHttp: () => ({ getRequest: () => ({ actor }) }),
  } as unknown as ExecutionContext;
}

function permissionsOf(method: (...args: never[]) => unknown): string[] | undefined {
  return Reflect.getMetadata(PERMISSIONS_KEY, method) as string[] | undefined;
}

describe("ImportsController permissions", () => {
  it("requires imports:write to upload a file", () => {
    expect(permissionsOf(ImportsController.prototype.upload)).toEqual(["imports:write"]);
  });

  it("requires imports:read for every read endpoint", () => {
    for (const name of READ_METHODS) {
      expect(permissionsOf(ImportsController.prototype[name])).toEqual(["imports:read"]);
    }
  });
});

describe("PermissionsGuard on import routes", () => {
  const guard = new PermissionsGuard(new Reflector());

  it("denies a session without imports:write", () => {
    const actor: RequestActor = { ...ACTOR, permissions: ["imports:read"] };
    expect(() => guard.canActivate(contextFor(ImportsController.prototype.upload, actor))).toThrow(
      /imports:write/,
    );
  });

  it("denies a session without imports:read", () => {
    const actor: RequestActor = { ...ACTOR, permissions: ["imports:write"] };
    expect(() => guard.canActivate(contextFor(ImportsController.prototype.get, actor))).toThrow(
      /imports:read/,
    );
  });

  it("allows a session that holds the permission", () => {
    expect(guard.canActivate(contextFor(ImportsController.prototype.upload, ACTOR))).toBe(true);
    expect(guard.canActivate(contextFor(ImportsController.prototype.rowErrors, ACTOR))).toBe(true);
  });

  it("denies an anonymous request before any permission check", () => {
    expect(() => guard.canActivate(contextFor(ImportsController.prototype.upload))).toThrow(
      /Authentication is required/,
    );
  });
});
