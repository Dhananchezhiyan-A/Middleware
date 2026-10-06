import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { RequestActor } from "@middleware/types";

/**
 * The authenticated actor — populated by JwtAuthGuard from the JWT/API key.
 * The actor ALWAYS comes from here, never from body/query/path params.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestActor => {
    const request = ctx.switchToHttp().getRequest<{ actor?: RequestActor }>();
    if (!request.actor) {
      throw new Error("CurrentUser used on a route without authentication.");
    }
    return request.actor;
  },
);
