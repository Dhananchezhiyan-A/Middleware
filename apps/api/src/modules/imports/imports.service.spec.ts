import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@middleware/shared";
import type { Database } from "@middleware/database";
import type { RequestActor } from "@middleware/types";
import type { AuditService } from "../../infra/audit.module";
import type { QueuesService } from "../../infra/redis.module";
import { ImportsService } from "./imports.service";
import type { UploadedCsvFile } from "./imports.dtos";

/**
 * Upload-path rules for CSV imports. Every rejection happens BEFORE the file is
 * stored or a job is created, so a bad upload leaves nothing behind.
 *
 * Storage is pointed at a throwaway directory (the driver is created lazily on
 * first use, i.e. only on the success-path test).
 */
const STORAGE_DIR = mkdtempSync(join(tmpdir(), "mw-imports-"));
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = STORAGE_DIR;

afterAll(() => {
  rmSync(STORAGE_DIR, { recursive: true, force: true });
});

const ACTOR: RequestActor = {
  userId: "user_1",
  email: "owner@demo.dev",
  role: "Owner",
  permissions: ["imports:read", "imports:write"],
  sessionId: "session_1",
  actorType: "USER",
  correlationId: "corr_1",
};

const VALID_CSV = ["email,first name,city", "priya@example.com,Priya,Chennai", "a@b.co,Ravi,Delhi"].join("\n");

interface Harness {
  service: ImportsService;
  prisma: {
    leadSource: { findFirst: ReturnType<typeof vi.fn> };
    leadSourceAccount: { findFirst: ReturnType<typeof vi.fn> };
    importJob: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    importRowError: { findMany: ReturnType<typeof vi.fn> };
  };
  queues: { enqueueCsvImport: ReturnType<typeof vi.fn> };
  audit: { record: ReturnType<typeof vi.fn> };
}

function harness(overrides: Partial<Harness["prisma"]> = {}): Harness {
  const prisma = {
    leadSource: { findFirst: vi.fn().mockResolvedValue({ id: "src_1" }) },
    leadSourceAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acc_1" }) },
    importJob: {
      create: vi.fn().mockResolvedValue({ id: "imp_1", fileName: "leads.csv", status: "PENDING" }),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    importRowError: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const queues = { enqueueCsvImport: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ImportsService(
    prisma as unknown as Database,
    audit as unknown as AuditService,
    queues as unknown as QueuesService,
  );
  return { service, prisma, queues, audit };
}

function csvFile(
  content: string,
  overrides: Partial<UploadedCsvFile> = {},
): UploadedCsvFile {
  const buffer = Buffer.from(content, "utf8");
  return {
    originalname: "leads.csv",
    mimetype: "text/csv",
    size: buffer.length,
    buffer,
    ...overrides,
  };
}

/** Asserts an AppError with a specific code, returns the thrown error. */
async function expectFailure(promise: Promise<unknown>, code: string): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return err as AppError;
  }
  throw new Error(`Expected the call to fail with ${code} but it resolved.`);
}

const input = { sourceId: "src_1" };

describe("ImportsService.createImport — file validation", () => {
  it("rejects a file without a .csv extension", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile(VALID_CSV, { originalname: "leads.xlsx" }), input),
      "BAD_REQUEST",
    );
    expect(err.message).toMatch(/Only \.csv files/i);
  });

  it("rejects a file above the server-side size limit", async () => {
    const { service, prisma } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile(VALID_CSV, { size: 11 * 1024 * 1024 }), input),
      "BAD_REQUEST",
    );
    expect(err.message).toMatch(/exceeds the \d+ MB limit/i);
    expect(prisma.importJob.create).not.toHaveBeenCalled();
  });

  it("rejects content that is not a CSV table", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile("just some prose without a header row"), input),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/header row/i);
  });

  it("rejects a file with no data rows", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile("email\n,\n"), input),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/no data rows/i);
  });

  it("rejects duplicate column names", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile("email,city,email\na@b.co,Chennai,c@x.co"), input),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/duplicate columns: email/i);
  });

  it("rejects a binary file masquerading as CSV", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile("email,city\na\u0000b,c"), input),
      "BAD_REQUEST",
    );
    expect(err.message).toMatch(/not CSV text/i);
  });

  it("rejects a file above the row limit without storing it", async () => {
    const { service, prisma } = harness();
    const header = "email";
    const rows = Array.from({ length: 100_001 }, (_, i) => `row${i}@example.com`);
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile([header, ...rows].join("\n")), input),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/row limit/i);
    expect(prisma.importJob.create).not.toHaveBeenCalled();
  });
});

describe("ImportsService.createImport — source and account", () => {
  it("requires an existing source", async () => {
    const { service, prisma } = harness({
      leadSource: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expectFailure(service.createImport(ACTOR, csvFile(VALID_CSV), input), "NOT_FOUND");
    expect(prisma.importJob.create).not.toHaveBeenCalled();
  });

  it("refuses a source that has no account yet", async () => {
    const { service } = harness({
      leadSourceAccount: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile(VALID_CSV), input),
      "NOT_FOUND",
    );
    expect(err.message).toMatch(/no account/i);
  });

  it("refuses an account that does not belong to the source", async () => {
    const { service, prisma } = harness({
      leadSourceAccount: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile(VALID_CSV), { sourceId: "src_1", sourceAccountId: "acc_other" }),
      "NOT_FOUND",
    );
    expect(err.message).toMatch(/does not belong/i);
    // The account lookup is scoped to the selected source.
    expect(prisma.leadSourceAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sourceId: "src_1", id: "acc_other" }) }),
    );
  });
});

describe("ImportsService.createImport — column mapping", () => {
  it("rejects an unknown lead field target", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile(VALID_CSV), {
        sourceId: "src_1",
        mapping: [{ column: "email", target: "not.a.field" }],
      }),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/Unknown lead field/);
  });

  it("rejects two columns mapped to the same field", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile(VALID_CSV), {
        sourceId: "src_1",
        mapping: [
          { column: "email", target: "email" },
          { column: "city", target: "email" },
        ],
      }),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/more than one column/);
  });

  it("rejects a mapping column that is not in the file", async () => {
    const { service } = harness();
    const err = await expectFailure(
      service.createImport(ACTOR, csvFile(VALID_CSV), {
        sourceId: "src_1",
        mapping: [{ column: "Phone Number", target: "phone" }],
      }),
      "VALIDATION_FAILED",
    );
    expect(err.message).toMatch(/not in the file/);
  });
});

describe("ImportsService.createImport — happy path", () => {
  it("stores the file, attaches source + account and queues the mapping", async () => {
    const { service, prisma, queues, audit } = harness();
    const mapping = [
      { column: "email", target: "email" },
      { column: "first name", target: "name.first" },
      { column: "city", target: "location.city" },
    ];

    const job = await service.createImport(ACTOR, csvFile(VALID_CSV), {
      sourceId: "src_1",
      sourceAccountId: "acc_1",
      mapping,
    });

    expect(job).toMatchObject({ id: "imp_1", status: "PENDING" });
    // Source AND account are persisted — the worker refuses without them.
    expect(prisma.importJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceId: "src_1", sourceAccountId: "acc_1" }),
      }),
    );
    expect(queues.enqueueCsvImport).toHaveBeenCalledWith(
      expect.objectContaining({ importJobId: "imp_1", createdBy: "user_1", mapping }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "import.created", entityId: "imp_1" }),
    );
  });

  it("works without an explicit mapping (header-alias fallback)", async () => {
    const { service, queues } = harness();
    await service.createImport(ACTOR, csvFile(VALID_CSV), { sourceId: "src_1" });
    expect(queues.enqueueCsvImport).toHaveBeenCalledWith(
      expect.not.objectContaining({ mapping: expect.anything() }),
    );
  });
});

describe("ImportsService.listRowErrors", () => {
  it("returns row numbers and reasons with a cursor", async () => {
    const { service, prisma } = harness();
    prisma.importJob.findFirst.mockResolvedValue({ id: "imp_1" });
    prisma.importRowError.findMany.mockResolvedValue([
      { id: "r1", rowNumber: 3, error: "Validation: bad email", rawRow: { email: "nope" } },
      { id: "r2", rowNumber: 7, error: "Validation: bad phone", rawRow: { phone: "1" } },
    ]);

    const page = await service.listRowErrors(ACTOR, "imp_1", { limit: 100 });

    expect(page.items).toEqual([
      { rowNumber: 3, error: "Validation: bad email", rawRow: { email: "nope" } },
      { rowNumber: 7, error: "Validation: bad phone", rawRow: { phone: "1" } },
    ]);
    // Two rows returned for limit=100 → nothing more to page to.
    expect(page.nextCursor).toBeNull();
  });

  it("fails with NOT_FOUND for an unknown import", async () => {
    const { service, prisma } = harness({
      importJob: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    await expectFailure(service.listRowErrors(ACTOR, "missing", {}), "NOT_FOUND");
    expect(prisma.importRowError.findMany).not.toHaveBeenCalled();
  });
});

describe("ImportsService.downloadErrors", () => {
  it("neutralises spreadsheet formula injection in the report", async () => {
    const { service, prisma } = harness();
    prisma.importJob.findFirst.mockResolvedValue({ id: "imp_1" });
    prisma.importRowError.findMany.mockResolvedValue([
      { rowNumber: 2, error: "=1+1", rawRow: { email: "a@b.co" } },
      { rowNumber: 3, error: "@SUM(A1)", rawRow: { email: "=cmd|'/c calc'!A1" } },
    ]);

    const csv = await service.downloadErrors(ACTOR, "imp_1");

    expect(csv).toContain("2,'=1+1,");
    expect(csv).toContain("'@SUM(A1)");
    // The injected value is inside a JSON object (cell starts with `{`), never
    // at the start of a cell.
    expect(csv).not.toMatch(/,=cmd/);
  });
});

describe("ImportsService.getImport", () => {
  it("requests only the safe shape (no storage internals)", async () => {
    const { service, prisma } = harness({
      importJob: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "imp_1",
          fileName: "leads.csv",
          status: "COMPLETED",
        }),
      },
    });

    await service.getImport(ACTOR, "imp_1");
    const call = prisma.importJob.findFirst.mock.calls[0]?.[0] as {
      select?: Record<string, boolean>;
    };
    expect(call.select).toBeDefined();
    expect(call.select).not.toHaveProperty("storageKey");
    expect(call.select).not.toHaveProperty("checksum");
  });
});
