import { describe, expect, it } from "vitest";
import { assertSafeDatabaseUrl, UnsafeDatabaseError } from "@middleware/config";
import { getPrisma } from "@middleware/database";

/**
 * DATA SAFETY GUARD — the single most important test in the repository.
 *
 * `assertSafeDatabaseUrl` runs before ANY Prisma connection or migration.
 * These cases prove the application can never be pointed at `dct_crm` (a
 * separate production system), a system database, or an unknown database in
 * development.
 */
describe("assertSafeDatabaseUrl (database safety guard)", () => {
  it("blocks dct_crm in every environment", () => {
    expect(() =>
      assertSafeDatabaseUrl("postgresql://postgres:pw@localhost:5432/dct_crm"),
    ).toThrow(UnsafeDatabaseError);
    expect(() =>
      assertSafeDatabaseUrl("postgresql://postgres:pw@db.example.com:5432/dct_crm"),
    ).toThrow(/blocked database/i);
  });

  it("blocks PostgreSQL system databases", () => {
    for (const db of ["postgres", "template0", "template1"]) {
      expect(() =>
        assertSafeDatabaseUrl(`postgresql://postgres:pw@localhost:5432/${db}`),
      ).toThrow(UnsafeDatabaseError);
    }
  });

  it("blocks a connection URL with no database name", () => {
    expect(() => assertSafeDatabaseUrl("postgresql://postgres:pw@localhost:5432")).toThrow(
      /must include a database name/i,
    );
    expect(() => assertSafeDatabaseUrl("postgresql://postgres:pw@localhost:5432/")).toThrow(
      UnsafeDatabaseError,
    );
  });

  it("blocks an unparseable URL", () => {
    expect(() => assertSafeDatabaseUrl("not-a-url")).toThrow(/not a valid connection URL/i);
    expect(() => assertSafeDatabaseUrl("")).toThrow(UnsafeDatabaseError);
  });

  it("blocks a non-loopback host outside production", () => {
    expect(() =>
      assertSafeDatabaseUrl("postgresql://postgres:pw@db.internal.example.com:5432/middleware"),
    ).toThrow(/loopback/i);
    expect(() =>
      assertSafeDatabaseUrl("postgresql://postgres:pw@10.0.0.5:5432/middleware"),
    ).toThrow(/loopback/i);
  });

  it("blocks any database other than `middleware` outside production", () => {
    expect(() => assertSafeDatabaseUrl("postgresql://postgres:pw@localhost:5432/leads_dev")).toThrow(
      /dedicated "middleware" database/i,
    );
  });

  it("blocks dct_crm even when the host is loopback", () => {
    expect(() => assertSafeDatabaseUrl("postgresql://postgres:pw@127.0.0.1:5432/dct_crm")).toThrow(
      /blocked database/i,
    );
  });

  it("allows the real DATABASE_URL (loopback + dedicated `middleware` database)", () => {
    const url = process.env.DATABASE_URL;
    expect(url, "DATABASE_URL must be set").toBeTruthy();
    expect(() => assertSafeDatabaseUrl(url as string)).not.toThrow();
    expect(new URL(url as string).pathname.replace(/^\//, "")).toBe("middleware");
  });

  it("connects to `middleware` and never to dct_crm", async () => {
    const prisma = getPrisma();
    const rows = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(rows[0]?.db).toBe("middleware");
  });
});
