import { Global, MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { RequestContextMiddleware } from "./request-context.middleware";

@Global()
@Module({})
export class RequestContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Named wildcard (path-to-regexp v8): matches every route, including the
    // ones with zero trailing segments. Legacy "*" is auto-converted with a
    // warning on every boot.
    consumer.apply(RequestContextMiddleware).forRoutes("{*path}");
  }
}
