import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "./index";

/**
 * STORAGE_LOCAL_DIR is relative in `.env` (`./storage`) but every process must
 * agree on the SAME directory: the API writes uploaded CSV files there and the
 * worker reads them back — each app runs with its own package directory as cwd.
 * `getEnv()` therefore anchors relative values at the workspace root (the
 * directory owning the `.env`), exactly like `.env` loading itself.
 */
describe("getEnv: storage path anchoring", () => {
  const original = process.env.STORAGE_LOCAL_DIR;

  afterEach(() => {
    if (original === undefined) delete process.env.STORAGE_LOCAL_DIR;
    else process.env.STORAGE_LOCAL_DIR = original;
    resetEnvCache();
    getEnv(); // leave a normally-cached env behind for any later assertion
  });

  it("resolves a relative STORAGE_LOCAL_DIR against the workspace root", () => {
    resetEnvCache();
    process.env.STORAGE_LOCAL_DIR = "./storage-anchored-test";
    getEnv();

    const value = process.env.STORAGE_LOCAL_DIR as string;
    expect(isAbsolute(value)).toBe(true);
    expect(value.replace(/\\/g, "/").endsWith("/storage-anchored-test")).toBe(true);
    // The anchor must be the workspace root — the directory that owns `.env` —
    // never a process-specific package directory like apps/api or apps/worker.
    expect(existsSync(join(dirname(value), ".env"))).toBe(true);
  });

  it("keeps an absolute STORAGE_LOCAL_DIR untouched", () => {
    resetEnvCache();
    const abs = join(process.cwd(), "some", "absolute", "dir");
    process.env.STORAGE_LOCAL_DIR = abs;
    getEnv();
    expect(process.env.STORAGE_LOCAL_DIR).toBe(abs);
  });

  it("defaults to <workspace root>/storage when nothing is set", () => {
    resetEnvCache();
    delete process.env.STORAGE_LOCAL_DIR;
    getEnv();

    const value = process.env.STORAGE_LOCAL_DIR ?? "";
    expect(isAbsolute(value)).toBe(true);
    expect(value.replace(/\\/g, "/").endsWith("/storage")).toBe(true);
    expect(existsSync(join(dirname(value), ".env"))).toBe(true);
  });
});
