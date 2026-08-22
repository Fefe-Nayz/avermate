import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const testDatabase = join(
  tmpdir(),
  `avermate-latex-worker-${process.pid}-${crypto.randomUUID()}.db`,
).replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${testDatabase}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let worker: typeof import("./build-document-latex");

const userId = "latex-worker-user";
const yearId = "latex-worker-year";

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client, {
    files: [testDatabase],
  });
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  await database.insert(schema.users).values({
    id: userId,
    name: "LaTeX worker",
    email: "latex-worker@example.com",
    emailVerified: true,
    role: "user",
    banned: false,
  });
  await database.insert(schema.years).values({
    id: yearId,
    name: "LaTeX year",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
    userId,
  });
  worker = await import("./build-document-latex");
}, 30_000);

afterAll(async () => {
  await database.delete(schema.users).where(eq(schema.users.id, userId));
});

async function buildFixture(input: {
  label: string;
  revision?: number;
  buildRevision?: number;
  metaVersion?: number;
  metaJson?: typeof schema.studyDocuments.$inferInsert.metaJson;
}) {
  const documentId = `latex_document_${input.label}_${crypto.randomUUID()}`;
  const revision = input.revision ?? 1;
  await database.insert(schema.studyDocuments).values({
    id: documentId,
    kind: "latex",
    title: `LaTeX ${input.label}`,
    bodyMarkdown: "\\documentclass{article}\\begin{document}OK\\end{document}",
    revision,
    metaVersion: input.metaVersion ?? 2,
    metaJson: input.metaJson ?? { engine: "xelatex", entry: "main.tex" },
    yearId,
    userId,
  });
  const [build] = await database
    .insert(schema.studyDocumentBuilds)
    .values({
      documentId,
      revision: input.buildRevision ?? revision,
      status: "queued",
      userId,
    })
    .returning();
  if (!build) throw new Error("LaTeX build fixture was not created");
  return { build, documentId };
}

const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture");

async function storePdf(
  input: Parameters<typeof import("../lib/storage").storeFile>[0],
) {
  expect(input).toMatchObject({ userId, purpose: "latex-build" });
  expect(input.file.type).toBe("application/pdf");
  const [stored] = await database
    .insert(schema.files)
    .values({
      provider: "local",
      storageKey: `private/latex-build/${userId}/${crypto.randomUUID()}.pdf`,
      url: "https://example.invalid/build.pdf",
      mimeType: input.file.type,
      byteSize: input.file.size,
      purpose: "latex-build",
      previewStatus: "unsupported",
      userId,
    })
    .returning();
  if (!stored) throw new Error("LaTeX PDF fixture was not stored");
  return stored;
}

describe("LaTeX document metadata", () => {
  test("accepts the three engines and rejects entry path traversal", async () => {
    const { latexMetaSchema, studyDocumentContentIssue } =
      await import("../lib/study-document-content");
    for (const engine of ["pdflatex", "xelatex", "lualatex"] as const) {
      expect(latexMetaSchema.parse({ engine, entry: "lesson.tex" })).toEqual({
        engine,
        entry: "lesson.tex",
      });
      expect(
        studyDocumentContentIssue("latex", "source", { engine }),
      ).toBeNull();
    }
    expect(() =>
      latexMetaSchema.parse({ engine: "xelatex", entry: "../main.tex" }),
    ).toThrow("without directories");
    expect(studyDocumentContentIssue("latex", "source", null)).toContain(
      "expected object",
    );
  });
});

describe("build.documentLatex worker", () => {
  test("detects declared packages for diagnostics without trusting comments", () => {
    expect(
      worker.declaredLatexPackages(String.raw`
        % \usepackage{ignored}
        \usepackage[francais]{babel}
        \RequirePackage{amsmath, amssymb}
        Price: \% \usepackage{xcolor}
        \usepackage{amsmath}
      `),
    ).toEqual(["babel", "amsmath", "amssymb", "xcolor"]);
  });

  test("builds a sandboxed Tectonic command with a controlled bundle and cache-only mode", () => {
    expect(
      worker.tectonicCompileCommand("C:/tmp/main.tex", "C:/tmp", {
        TECTONIC_BIN: "tectonic-custom",
        TECTONIC_BUNDLE: "https://bundles.invalid/tex.tar",
        TECTONIC_ONLY_CACHED: "true",
      }),
    ).toEqual([
      "tectonic-custom",
      "--untrusted",
      "--keep-logs",
      "--bundle",
      "https://bundles.invalid/tex.tar",
      "--only-cached",
      "--outdir",
      "C:/tmp",
      "C:/tmp/main.tex",
    ]);
  });

  test("does not expose application secrets to the native compiler", () => {
    const environment = worker.latexNativeEnvironment({
      PATH: "C:/tools",
      TEMP: "C:/temp",
      TECTONIC_CACHE_DIR: "C:/cache",
      DATABASE_URL: "file:secret.db",
      MISTRAL_API_KEY: "secret-mistral-key",
      S3_SECRET_ACCESS_KEY: "secret-storage-key",
    });
    expect(environment).toEqual({
      PATH: "C:/tools",
      TEMP: "C:/temp",
      TECTONIC_CACHE_DIR: "C:/cache",
      TECTONIC_UNTRUSTED_MODE: "1",
    });
  });

  test("rejects malformed payloads as non-retryable", async () => {
    await expect(
      worker.runBuildDocumentLatexJob({ buildId: "x", extra: 1 }),
    ).rejects.toMatchObject({ name: "NonRetryableJobError" });
  });

  test("fails an unavailable engine explicitly instead of silently using XeTeX", async () => {
    const result = await worker.compileDocumentLatex({
      source: "\\documentclass{article}",
      meta: { engine: "pdflatex" },
      timeoutMs: 100,
      maxPages: 1,
    });
    expect(result).toEqual({
      status: "failed",
      log: "pdflatex is not available on this server; the sandboxed Tectonic worker supports xelatex",
    });
  });

  test("stores, adopts and reuses the PDF for one immutable revision", async () => {
    const fixture = await buildFixture({ label: "success" });
    let compileCount = 0;
    const first = await worker.runBuildDocumentLatexJob(
      { buildId: fixture.build.id },
      {
        compileLatex: async (input) => {
          compileCount += 1;
          expect(input).toMatchObject({
            timeoutMs: worker.LATEX_BUILD_TIMEOUT_MS,
            maxPages: worker.LATEX_BUILD_MAX_PAGES,
            meta: { engine: "xelatex", entry: "main.tex" },
          });
          return {
            status: "succeeded",
            pdfBytes,
            pageCount: 1,
            log: "This is Tectonic, success",
          };
        },
        storeFile: storePdf,
      },
    );
    expect(first).toMatchObject({
      buildId: fixture.build.id,
      revision: 1,
      pageCount: 1,
      status: "succeeded",
    });
    const second = await worker.runBuildDocumentLatexJob(
      { buildId: fixture.build.id },
      {
        compileLatex: async () => {
          throw new Error("an adopted revision must not compile twice");
        },
      },
    );
    expect(second).toMatchObject({
      buildId: fixture.build.id,
      pdfFileId: first.pdfFileId,
      status: "succeeded",
    });
    expect(compileCount).toBe(1);
    const [storedBuild] = await database
      .select()
      .from(schema.studyDocumentBuilds)
      .where(eq(schema.studyDocumentBuilds.id, fixture.build.id));
    expect(storedBuild).toMatchObject({
      status: "succeeded",
      pdfFileId: first.pdfFileId,
      log: "This is Tectonic, success",
    });
  });

  test("persists the compiler's own failure words without failing the queue job", async () => {
    const fixture = await buildFixture({ label: "compiler-failure" });
    const result = await worker.runBuildDocumentLatexJob(
      { buildId: fixture.build.id },
      {
        attempt: 1,
        maxAttempts: 3,
        compileLatex: async () => ({
          status: "failed",
          log: "main.tex:7: Undefined control sequence \\badcommand",
        }),
      },
    );
    expect(result).toEqual({
      buildId: fixture.build.id,
      revision: 1,
      status: "failed",
    });
    const [storedBuild] = await database
      .select()
      .from(schema.studyDocumentBuilds)
      .where(eq(schema.studyDocumentBuilds.id, fixture.build.id));
    expect(storedBuild).toMatchObject({
      status: "failed",
      pdfFileId: null,
      log: "main.tex:7: Undefined control sequence \\badcommand",
    });
  });

  test("requeues a transient infrastructure outage and succeeds on retry", async () => {
    const fixture = await buildFixture({ label: "transient-outage" });
    let compileCount = 0;
    const compileLatex = async () => {
      compileCount += 1;
      return {
        status: "succeeded" as const,
        pdfBytes,
        pageCount: 1,
        log: "compiled during storage outage",
      };
    };

    await expect(
      worker.runBuildDocumentLatexJob(
        { buildId: fixture.build.id },
        {
          attempt: 1,
          maxAttempts: 2,
          compileLatex,
          storeFile: async () => {
            throw new Error("storage temporarily unavailable");
          },
        },
      ),
    ).rejects.toThrow("storage temporarily unavailable");

    const [queuedBuild] = await database
      .select()
      .from(schema.studyDocumentBuilds)
      .where(eq(schema.studyDocumentBuilds.id, fixture.build.id));
    expect(queuedBuild).toMatchObject({
      status: "queued",
      pdfFileId: null,
      log: "storage temporarily unavailable",
    });

    const result = await worker.runBuildDocumentLatexJob(
      { buildId: fixture.build.id },
      {
        attempt: 2,
        maxAttempts: 2,
        compileLatex,
        storeFile: storePdf,
      },
    );
    expect(result).toMatchObject({
      buildId: fixture.build.id,
      status: "succeeded",
    });
    expect(compileCount).toBe(2);

    const [storedBuild] = await database
      .select()
      .from(schema.studyDocumentBuilds)
      .where(eq(schema.studyDocumentBuilds.id, fixture.build.id));
    expect(storedBuild).toMatchObject({
      status: "succeeded",
      pdfFileId: result.pdfFileId,
      log: "compiled during storage outage",
    });
  });

  test("publishes an infrastructure outage as failed on the final attempt", async () => {
    const fixture = await buildFixture({ label: "terminal-outage" });
    const result = await worker.runBuildDocumentLatexJob(
      { buildId: fixture.build.id },
      {
        attempt: 2,
        maxAttempts: 2,
        compileLatex: async () => ({
          status: "succeeded",
          pdfBytes,
          pageCount: 1,
          log: "compiled before terminal storage outage",
        }),
        storeFile: async () => {
          throw new Error("storage remains unavailable");
        },
      },
    );
    expect(result).toEqual({
      buildId: fixture.build.id,
      revision: 1,
      status: "failed",
    });

    const [storedBuild] = await database
      .select()
      .from(schema.studyDocumentBuilds)
      .where(eq(schema.studyDocumentBuilds.id, fixture.build.id));
    expect(storedBuild).toMatchObject({
      status: "failed",
      pdfFileId: null,
      log: "storage remains unavailable",
    });
  });

  test("fences a source revision that changed before execution", async () => {
    const fixture = await buildFixture({
      label: "stale",
      revision: 2,
      buildRevision: 1,
    });
    const result = await worker.runBuildDocumentLatexJob(
      { buildId: fixture.build.id },
      {
        compileLatex: async () => {
          throw new Error("stale source must not compile");
        },
      },
    );
    expect(result.status).toBe("failed");
    const [storedBuild] = await database
      .select()
      .from(schema.studyDocumentBuilds)
      .where(eq(schema.studyDocumentBuilds.id, fixture.build.id));
    expect(storedBuild?.log).toContain("revision changed");
  });

  test("rejects an injected compiler result beyond the page cap before storage", async () => {
    const fixture = await buildFixture({ label: "page-cap" });
    let stored = false;
    const result = await worker.runBuildDocumentLatexJob(
      { buildId: fixture.build.id },
      {
        compileLatex: async () => ({
          status: "succeeded",
          pdfBytes,
          pageCount: worker.LATEX_BUILD_MAX_PAGES + 1,
          log: "compiler completed",
        }),
        storeFile: async () => {
          stored = true;
          throw new Error("over-limit PDFs must not reach storage");
        },
      },
    );
    expect(result.status).toBe("failed");
    expect(stored).toBe(false);
  });

  test("reconciles an adoption acknowledgement lost after the database write", async () => {
    const fixture = await buildFixture({ label: "lost-ack" });
    const result = await worker.runBuildDocumentLatexJob(
      { buildId: fixture.build.id },
      {
        compileLatex: async () => ({
          status: "succeeded",
          pdfBytes,
          pageCount: 1,
          log: "compiled before acknowledgement loss",
        }),
        storeFile: storePdf,
        afterAdopt: async () => {
          throw new Error("simulated acknowledgement loss");
        },
      },
    );
    expect(result).toMatchObject({
      buildId: fixture.build.id,
      status: "succeeded",
    });
    const [storedBuild] = await database
      .select()
      .from(schema.studyDocumentBuilds)
      .where(eq(schema.studyDocumentBuilds.id, fixture.build.id));
    expect(storedBuild).toMatchObject({
      status: "succeeded",
      pdfFileId: result.pdfFileId,
    });
  });

  test("retains only three PDF artifacts while preserving build history", async () => {
    const fixture = await buildFixture({ label: "retention" });
    const builds = [fixture.build];
    const fileIds: string[] = [];
    for (let revision = 1; revision <= 4; revision += 1) {
      const [file] = await database
        .insert(schema.files)
        .values({
          provider: "test",
          storageKey: `latex-retention-${crypto.randomUUID()}`,
          url: `https://example.invalid/retention-${revision}.pdf`,
          mimeType: "application/pdf",
          byteSize: 12,
          purpose: "latex-build",
          previewStatus: "unsupported",
          userId,
        })
        .returning();
      fileIds.push(file!.id);
      const build =
        revision === 1
          ? fixture.build
          : (
              await database
                .insert(schema.studyDocumentBuilds)
                .values({
                  documentId: fixture.documentId,
                  revision,
                  status: "succeeded",
                  pdfFileId: file!.id,
                  userId,
                })
                .returning()
            )[0]!;
      if (revision === 1) {
        await database
          .update(schema.studyDocumentBuilds)
          .set({ status: "succeeded", pdfFileId: file!.id })
          .where(eq(schema.studyDocumentBuilds.id, build.id));
      }
      await database.insert(schema.documentArtifacts).values({
        documentId: fixture.documentId,
        kind: "pdf",
        variant: "default",
        sourceRevision: revision,
        status: "succeeded",
        fileId: file!.id,
        userId,
      });
      if (revision > 1) builds.push(build);
    }

    expect(
      await worker.pruneLatexBuildArtifacts(
        {
          userId,
          documentId: fixture.documentId,
          currentBuildId: builds[3]!.id,
          retainedArtifacts: 3,
        },
        {
          removeFile: async (ownerId, fileId) => {
            const [removed] = await database
              .update(schema.files)
              .set({ status: "deleted", updatedAt: new Date() })
              .where(eq(schema.files.id, fileId))
              .returning();
            expect(removed?.userId).toBe(ownerId);
            return removed!;
          },
        },
      ),
    ).toEqual({ reclaimed: 1, retained: 3 });

    const history = await database
      .select()
      .from(schema.studyDocumentBuilds)
      .where(eq(schema.studyDocumentBuilds.documentId, fixture.documentId));
    expect(history).toHaveLength(4);
    expect(history.find((build) => build.revision === 1)?.pdfFileId).toBeNull();
    expect(
      history
        .filter((build) => build.pdfFileId !== null)
        .map((build) => build.revision)
        .sort(),
    ).toEqual([2, 3, 4]);
    expect(
      (
        await database
          .select()
          .from(schema.files)
          .where(eq(schema.files.id, fileIds[0]!))
      )[0]?.status,
    ).toBe("deleted");
    const artifacts = await database
      .select()
      .from(schema.documentArtifacts)
      .where(eq(schema.documentArtifacts.documentId, fixture.documentId));
    expect(artifacts).toHaveLength(3);
    expect(
      artifacts
        .map((artifact) => artifact.sourceRevision)
        .sort((left, right) => left - right),
    ).toEqual([2, 3, 4]);
    expect(
      artifacts.some(
        (artifact) =>
          artifact.status === "succeeded" && artifact.fileId === fileIds[0],
      ),
    ).toBe(false);
  });

  test("truncates hostile compiler output at the durable byte bound", () => {
    const value = `prefix:${"é".repeat(worker.LATEX_BUILD_MAX_LOG_BYTES)}`;
    const truncated = worker.truncateLatexLog(value);
    expect(new TextEncoder().encode(truncated).byteLength).toBeLessThan(
      worker.LATEX_BUILD_MAX_LOG_BYTES + 100,
    );
    expect(truncated).toEndWith("[compiler output truncated]");
  });
});
