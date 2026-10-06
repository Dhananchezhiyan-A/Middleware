import { Injectable } from "@nestjs/common";
import { getPrisma } from "@middleware/database";
import { createDefaultRegistry } from "@middleware/integrations";
import { decryptSecret, encryptSecret, errors } from "@middleware/shared";
import type { RequestActor } from "@middleware/types";
import { AuditService } from "../../infra/audit.module";

/**
 * Destinations + credentials + REAL connectivity probes.
 *
 * Secrets are write-only: accepted by setCredential, stored AES-256-GCM,
 * returned only as `{ stored: true }`. testConnection performs an actual
 * network probe through the adapter — there is no synthetic success path.
 */
@Injectable()
export class DestinationsService {
  private readonly registry = createDefaultRegistry();

  constructor(private readonly audit: AuditService) {}

  /** Supported destination types with the config keys each adapter requires. */
  listTypes() {
    return this.registry.types().map((type) => {
      const adapter = this.registry.get(type);
      // Real adapter validation against empty config → actual missing keys.
      const missingConfig = adapter.validate({ id: "", type, name: "", config: {} }, undefined);
      return { type, requiredConfigKeys: missingConfig };
    });
  }

  async list(_actor: RequestActor) {
    return getPrisma().destination.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        health: true,
        _count: { select: { deliveries: true, fieldMappings: true } },
      },
    });
  }

  async get(_actor: RequestActor, id: string) {
    const destination = await getPrisma().destination.findFirst({
      where: { id },
      include: { health: true, _count: { select: { deliveries: true, fieldMappings: true } } },
    });
    if (!destination) throw errors.notFound("Destination not found.");
    const credential = await getPrisma().integrationCredential.findFirst({
      where: { destinationId: id },
      select: { id: true, type: true, meta: true, createdAt: true, rotatedAt: true },
    });
    return { ...destination, credential };
  }

  async create(
    _actor: RequestActor,
    input: { type: string; name: string; config?: Record<string, unknown>; rateLimitPerSec?: number },
  ) {
    const prisma = getPrisma();
    try {
      const destination = await prisma.destination.create({
        data: {
          type: input.type as never,
          name: input.name,
          config: (input.config ?? {}) as never,
          ...(input.rateLimitPerSec !== undefined ? { rateLimitPerSec: input.rateLimitPerSec } : {}),
        },
      });
      await this.audit.record({
        action: "destination.created",
        entityType: "Destination",
        entityId: destination.id,
        after: destination,
      });
      return destination;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw errors.conflict(`A destination named "${input.name}" already exists.`);
      }
      throw err;
    }
  }

  async update(
    actor: RequestActor,
    id: string,
    input: { name?: string; status?: string; config?: Record<string, unknown>; rateLimitPerSec?: number | null },
  ) {
    const before = await this.get(actor, id);
    const destination = await getPrisma().destination.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status as never } : {}),
        ...(input.config !== undefined ? { config: input.config as never } : {}),
        ...(input.rateLimitPerSec !== undefined ? { rateLimitPerSec: input.rateLimitPerSec } : {}),
      },
    });
    await this.audit.record({
      action: "destination.updated",
      entityType: "Destination",
      entityId: id,
      before: { name: before.name, status: before.status, config: before.config },
      after: { name: destination.name, status: destination.status, config: destination.config },
    });
    return destination;
  }

  async remove(actor: RequestActor, id: string): Promise<{ deleted: boolean }> {
    const before = await this.get(actor, id);
    try {
      await getPrisma().destination.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2003") {
        throw errors.conflict(
          "Destination has deliveries or routing targets and cannot be deleted. Disable it instead.",
        );
      }
      throw err;
    }
    await this.audit.record({
      action: "destination.deleted",
      entityType: "Destination",
      entityId: id,
      before: { name: before.name, type: before.type },
    });
    return { deleted: true };
  }

  // --- Credentials (write-only) -----------------------------------------------

  async setCredential(
    actor: RequestActor,
    destinationId: string,
    input: { type: string; secret: string; meta?: Record<string, unknown> },
  ): Promise<{ stored: boolean; type: string }> {
    const prisma = getPrisma();
    await this.get(actor, destinationId); // 404 if the destination does not exist
    const encrypted = encryptSecret(input.secret);
    const existing = await prisma.integrationCredential.findFirst({
      where: { destinationId },
    });
    if (existing) {
      await prisma.integrationCredential.update({
        where: { id: existing.id },
        data: { type: input.type as never, secret: encrypted, meta: (input.meta ?? existing.meta ?? {}) as never, rotatedAt: new Date() },
      });
    } else {
      await prisma.integrationCredential.create({
        data: {
          destinationId,
          type: input.type as never,
          secret: encrypted,
          meta: (input.meta ?? {}) as never,
        },
      });
    }
    await this.audit.record({
      action: existing ? "destination.credential.updated" : "destination.credential.created",
      entityType: "Destination",
      entityId: destinationId,
      // Secret never enters the audit trail (AuditService also sanitizes).
      metadata: { credentialType: input.type },
    });
    return { stored: true, type: input.type };
  }

  async removeCredential(actor: RequestActor, destinationId: string): Promise<{ removed: boolean }> {
    await this.get(actor, destinationId);
    const res = await getPrisma().integrationCredential.deleteMany({
      where: { destinationId },
    });
    await this.audit.record({
      action: "destination.credential.removed",
      entityType: "Destination",
      entityId: destinationId,
    });
    return { removed: res.count > 0 };
  }

  // --- Health (real probes only) ----------------------------------------------

  async getHealth(actor: RequestActor, destinationId: string) {
    await this.get(actor, destinationId);
    const health = await getPrisma().destinationHealth.findUnique({ where: { destinationId } });
    return health ?? { destinationId, status: "NOT_CONFIGURED" };
  }

  /**
   * Real connectivity/auth probe through the destination adapter. The stored
   * credential is decrypted in-memory, used for the probe, and never logged.
   */
  async testConnection(actor: RequestActor, destinationId: string) {
    const prisma = getPrisma();
    const destination = await this.get(actor, destinationId);
    const adapter = this.registry.get(destination.type);

    const credRow = await prisma.integrationCredential.findFirst({
      where: { destinationId },
    });
    const credential = credRow
      ? {
          type: credRow.type,
          secret: decryptSecret(credRow.secret),
          meta: (credRow.meta ?? {}) as Record<string, unknown>,
        }
      : undefined;

    const started = Date.now();
    let result;
    try {
      result = await adapter.testConnection(
        {
          id: destination.id,
          type: destination.type,
          name: destination.name,
          config: (destination.config ?? {}) as Record<string, unknown>,
          rateLimitPerSec: destination.rateLimitPerSec,
        },
        credential,
      );
    } catch (err) {
      result = {
        ok: false,
        status: "ERROR" as const,
        error: err instanceof Error ? err.message : "Connection test failed",
      };
    }
    const latencyMs = result.latencyMs ?? Date.now() - started;
    const now = new Date();

    await prisma.destinationHealth.upsert({
      where: { destinationId },
      create: {
        destinationId,
        status: result.status,
        lastSuccessAt: result.ok ? now : null,
        lastFailureAt: result.ok ? null : now,
        lastError: result.ok ? null : (result.error ?? null),
        lastLatencyMs: latencyMs,
        checkedAt: now,
      },
      update: {
        status: result.status,
        ...(result.ok ? { lastSuccessAt: now } : { lastFailureAt: now }),
        lastError: result.ok ? null : (result.error ?? null),
        lastLatencyMs: latencyMs,
        checkedAt: now,
      },
    });

    await this.audit.record({
      action: "destination.tested",
      entityType: "Destination",
      entityId: destinationId,
      metadata: { ok: result.ok, status: result.status, latencyMs },
    });

    return { ...result, latencyMs };
  }
}
