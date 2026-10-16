import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RequestActor } from "@middleware/types";
import { PERMISSIONS_KEY } from "../../common/decorators/permissions.decorator";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { LeadsController } from "./leads.controller";

/**
 * Authorization for the lead endpoints (including the manual-delivery flow)
 * is enforced by PermissionsGuard from the metadata on each handler — the
 * browser only hides what the API refuses. These tests pin the metadata AND
 * prove the guard denies sessions that are missing the permission.
 */

const ACTOR: RequestActor = {
  userId: "user_1",
  email: "owner@demo.dev",
  role: "Owner",
  permissions: ["leads:read", "leads:write", "leads:replay"],
  sessionId: "session_1",
  actorType: "USER",
  correlationId: "corr_1",
};

function contextFor(method: (...args: never[]) => unknown, actor?: RequestActor): ExecutionContext {
  return {
    getHandler: () => method,
    getClass: () => LeadsController,
    switchToHttp: () => ({ getRequest: () => ({ actor }) }),
  } as unknown as ExecutionContext;
}

function permissionsOf(method: (...args: never[]) => unknown): string[] | undefined {
  return Reflect.getMetadata(PERMISSIONS_KEY, method) as string[] | undefined;
}

describe("LeadsController permissions", () => {
  it("pins the permission of every endpoint", () => {
    expect(permissionsOf(LeadsController.prototype.list)).toEqual(["leads:read"]);
    expect(permissionsOf(LeadsController.prototype.create)).toEqual(["leads:write"]);
    expect(permissionsOf(LeadsController.prototype.createSelection)).toEqual(["leads:read"]);
    expect(permissionsOf(LeadsController.prototype.preview)).toEqual(["leads:replay"]);
    expect(permissionsOf(LeadsController.prototype.send)).toEqual(["leads:replay"]);
    expect(permissionsOf(LeadsController.prototype.replay)).toEqual(["leads:replay"]);
  });
});

describe("PermissionsGuard on lead routes", () => {
  const guard = new PermissionsGuard(new Reflector());

  it("denies a viewer (leads:read only) from previewing or sending", () => {
    const actor: RequestActor = { ...ACTOR, permissions: ["leads:read"] };
    expect(() => guard.canActivate(contextFor(LeadsController.prototype.send, actor))).toThrow(
      /leads:replay/,
    );
    expect(() => guard.canActivate(contextFor(LeadsController.prototype.preview, actor))).toThrow(
      /leads:replay/,
    );
  });

  it("allows a leads:replay session to create a selection, preview and send", () => {
    expect(
      guard.canActivate(contextFor(LeadsController.prototype.createSelection, ACTOR)),
    ).toBe(true);
    expect(guard.canActivate(contextFor(LeadsController.prototype.preview, ACTOR))).toBe(true);
    expect(guard.canActivate(contextFor(LeadsController.prototype.send, ACTOR))).toBe(true);
  });

  it("denies an anonymous request before any permission check", () => {
    expect(() => guard.canActivate(contextFor(LeadsController.prototype.send))).toThrow(
      /Authentication is required/,
    );
  });
});
