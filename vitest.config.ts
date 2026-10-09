import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The web app imports its own modules as "@/…"; without this the
    // apps/web specs cannot load components that use the alias.
    alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
  },
  test: {
    name: "unit",
    environment: "node",
    include: [
      "packages/*/src/**/*.spec.ts",
      "packages/*/src/**/*.test.ts",
      "apps/api/src/**/*.spec.ts",
      "apps/worker/src/**/*.spec.ts",
      "apps/web/src/**/*.spec.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
