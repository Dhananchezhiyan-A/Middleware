import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relativePath: string) => readFileSync(join(here, relativePath), "utf8");

/** Inbound source setup must not surface or persist signing secrets. */
const secretHandlers = [
  "./source-accounts-dialog.tsx",
  "./account-dialog.tsx",
  "../../lib/queries/integrations.ts",
];

const FORBIDDEN_SINKS: Array<[name: string, pattern: RegExp]> = [
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["document.cookie", /document\.cookie/],
  ["document.title", /document\.title/],
  ["console output", /\bconsole\.(log|debug|info|warn|error|trace)\s*\(/],
  ["URL/query state", /URLSearchParams|location\.(search|hash|href)/],
  ["history state", /history\.(pushState|replaceState)/],
  ["React Query cache writes", /setQueryData/],
  ["indexedDB", /indexedDB/],
  ["web storage fallbacks", /window\.name|BroadcastChannel/],
];

describe("public webhook setup does not require signing secrets", () => {
  for (const relativePath of secretHandlers) {
    it(`${relativePath} has no persistence/console/cache sinks`, () => {
      const source = read(relativePath);
      for (const [name, pattern] of FORBIDDEN_SINKS) {
        expect(source, `forbidden sink: ${name}`).not.toMatch(pattern);
      }
    });
  }

  it("source setup presents public URL posting without signature instructions", () => {
    const source = read("./source-accounts-dialog.tsx");
    expect(source).toContain("Send a POST request to this URL with your lead data.");
    expect(source).not.toMatch(/x-signature|HMAC|WEBHOOK_SIGNING_SECRET|CryptoJS|Node crypto/);
    expect(source).toContain("Required fields");
  });
});
