import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { getEnv } from "@middleware/config";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { RolesModule } from "./modules/roles/roles.module";
import { ApiKeysModule } from "./modules/api-keys/api-keys.module";
import { SourcesModule } from "./modules/sources/sources.module";
import { DestinationsModule } from "./modules/destinations/destinations.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { RoutingRulesModule } from "./modules/routing-rules/routing-rules.module";
import { FieldMappingsModule } from "./modules/field-mappings/field-mappings.module";
import { DeliveriesModule } from "./modules/deliveries/deliveries.module";
import { ImportsModule } from "./modules/imports/imports.module";
import { AuditLogsModule } from "./modules/audit-logs/audit-logs.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AutomationModule } from "./modules/automation/automation.module";
import { PrismaModule } from "./infra/prisma.module";
import { RedisModule } from "./infra/redis.module";
import { AuditModule } from "./infra/audit.module";
import { RequestContextModule } from "./common/context/request-context.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { CorrelationInterceptor } from "./common/interceptors/correlation.interceptor";
import { ResponseTransformInterceptor } from "./common/interceptors/response-transform.interceptor";

const env = getEnv();

@Module({
  imports: [
    // Infra
    RequestContextModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    // Rate limiting (global default; routes override via @Throttle)
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60_000,
        limit: env.API_RATE_LIMIT_PER_MIN,
      },
    ]),
    // Feature modules
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    ApiKeysModule,
    SourcesModule,
    DestinationsModule,
    LeadsModule,
    WebhooksModule,
    RoutingRulesModule,
    FieldMappingsModule,
    DeliveriesModule,
    ImportsModule,
    AuditLogsModule,
    AnalyticsModule,
    AutomationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
  ],
})
export class AppModule {}
