import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { QueuesService } from "../../infra/redis.module";
import { getPrisma } from "@middleware/database";

interface HealthReport {
  status: "ok" | "degraded";
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    redis: { ok: boolean; latencyMs?: number; error?: string };
  };
  version: string;
  uptimeSec: number;
}

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly queues: QueuesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Liveness/readiness probe with real dependency checks" })
  async getHealth(): Promise<HealthReport> {
    // Real probes — never synthetic OKs.
    let dbCheck: HealthReport["checks"]["database"];
    try {
      const started = Date.now();
      await getPrisma().$queryRaw`SELECT 1`;
      dbCheck = { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      dbCheck = { ok: false, error: err instanceof Error ? err.message : "database unreachable" };
    }

    const redisRaw = await this.queues.ping();
    const redisCheck: HealthReport["checks"]["redis"] = redisRaw.ok
      ? { ok: true, latencyMs: redisRaw.latencyMs }
      : { ok: false, error: redisRaw.error };

    const ok = dbCheck.ok && redisCheck.ok;
    return {
      status: ok ? "ok" : "degraded",
      checks: { database: dbCheck, redis: redisCheck },
      version: process.env.npm_package_version ?? "0.1.0",
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
