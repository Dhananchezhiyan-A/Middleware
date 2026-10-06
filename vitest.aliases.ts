import { fileURLToPath } from "node:url";

/**
 * Workspace aliases for the root-level test suites (`tests/**`).
 *
 * `tests/` lives outside every workspace package, so Node cannot resolve
 * `@middleware/*` from there — the packages are only linked inside each
 * app's `node_modules`. Aliasing to the TypeScript sources keeps a single
 * module instance per package across tests AND the app code under test
 * (important for module-level singletons such as the Prisma client).
 */
export const middlewareAliases: Record<string, string> = {
  "@middleware/types": fileURLToPath(new URL("./packages/types/src/index.ts", import.meta.url)),
  "@middleware/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
  "@middleware/config": fileURLToPath(new URL("./packages/config/src/index.ts", import.meta.url)),
  "@middleware/database": fileURLToPath(new URL("./packages/database/src/index.ts", import.meta.url)),
  "@middleware/integrations": fileURLToPath(
    new URL("./packages/integrations/src/index.ts", import.meta.url),
  ),
  "@middleware/validation": fileURLToPath(
    new URL("./packages/validation/src/index.ts", import.meta.url),
  ),
};
