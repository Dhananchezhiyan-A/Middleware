import { defineConfig } from "vitest/config";

export default defineConfig({
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
