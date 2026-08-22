import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const testDatabase = join(
  tmpdir(),
  `avermate-material-preview-${process.pid}-${crypto.randomUUID()}.db`,
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
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let worker: typeof import("./material-preview");

const userId = "material-preview-user";

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
    name: "Preview worker",
    email: "preview-worker@example.com",
    emailVerified: true,
    role: "user",
    banned: false,
  });
  worker = await import("./material-preview");
}, databaseHookTimeout);

afterAll(async () => {
  await database.delete(schema.users).where(eq(schema.users.id, userId));
}, databaseHookTimeout);

async function sourceFile(label: string, mimeType: string) {
  const [file] = await database
    .insert(schema.files)
    .values({
      id: `preview_source_${label}_${crypto.randomUUID()}`,
      provider: "local",
      storageKey: `private/course-material/${userId}/${label}`,
      url: `https://example.invalid/${label}`,
      mimeType,
      byteSize: 3,
      purpose: "course-material",
      userId,
    })
    .returning();
  if (!file) throw new Error("Preview source fixture was not created");
  return file;
}

const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

describe("materials.preview worker", () => {
  test("fails closed instead of running native preview tools in the API process", async () => {
    await expect(
      worker.renderMaterialPreview({
        bytes: Uint8Array.from([1, 2, 3]),
        mimeType: "image/png",
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({
      name: "NonRetryableJobError",
      message: expect.stringContaining("SANDBOX_EXECUTION_REQUIRED:media"),
    });
  });

  test("rejects malformed payloads without retrying unsafe input", async () => {
    await expect(worker.runMaterialPreviewJob({ fileId: "x", extra: true }))
      .rejects.toMatchObject({ name: "NonRetryableJobError" });
  });

  test("classifies unsupported files without reading their object", async () => {
    const source = await sourceFile("unsupported", "text/plain");
    const result = await worker.runMaterialPreviewJob(
      { fileId: source.id },
      {
        readStorageObject: async () => {
          throw new Error("unsupported content must not be read");
        },
      },
    );
    expect(result).toEqual({ fileId: source.id, status: "unsupported" });
    const [updated] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, source.id));
    expect(updated).toMatchObject({
      previewFileId: null,
      previewStatus: "unsupported",
    });
  });

  test("stores one WebP and reuses the adopted preview idempotently", async () => {
    const source = await sourceFile("ready", "image/png");
    let renders = 0;
    const storePreview = async (
      input: Parameters<typeof import("../lib/storage").storeFile>[0],
    ) => {
      expect(input).toMatchObject({ userId, purpose: "preview" });
      expect(input.file.type).toBe("image/webp");
      const [stored] = await database
        .insert(schema.files)
        .values({
          provider: "local",
          storageKey: `private/preview/${userId}/${crypto.randomUUID()}`,
          url: "https://example.invalid/preview.webp",
          mimeType: input.file.type,
          byteSize: input.file.size,
          purpose: "preview",
          previewStatus: "unsupported",
          userId,
        })
        .returning();
      if (!stored) throw new Error("Preview fixture was not stored");
      return stored;
    };
    const first = await worker.runMaterialPreviewJob(
      { fileId: source.id },
      {
        readStorageObject: async () => Uint8Array.from([1, 2, 3]).buffer,
        renderPreview: async () => {
          renders += 1;
          return webp;
        },
        storeFile: storePreview,
      },
    );
    expect(first).toMatchObject({ status: "ready", fileId: source.id });
    const second = await worker.runMaterialPreviewJob(
      { fileId: source.id },
      {
        renderPreview: async () => {
          throw new Error("an adopted preview must not be rendered again");
        },
      },
    );
    expect(second).toEqual(first);
    expect(renders).toBe(1);
    const [updated] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, source.id));
    expect(updated).toMatchObject({
      previewFileId: first.previewFileId,
      previewStatus: "ready",
    });
  });

  test("records renderer failures as a domain result without crashing the queue", async () => {
    const source = await sourceFile("failed", "image/jpeg");
    const result = await worker.runMaterialPreviewJob(
      { fileId: source.id },
      {
        readStorageObject: async () => Uint8Array.from([1, 2, 3]).buffer,
        renderPreview: async () => {
          throw new Error("native renderer unavailable");
        },
      },
    );
    expect(result).toMatchObject({
      fileId: source.id,
      status: "failed",
      error: "native renderer unavailable",
    });
    const [updated] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, source.id));
    expect(updated).toMatchObject({
      previewFileId: null,
      previewStatus: "failed",
    });
  });

  test("keeps transient storage failures retryable until the last queue attempt", async () => {
    const readSource = await sourceFile("retry-read", "image/png");
    await expect(
      worker.runMaterialPreviewJob(
        { fileId: readSource.id },
        {
          attempt: 1,
          maxAttempts: 3,
          readStorageObject: async () => {
            throw new Error("temporary object-store outage");
          },
        },
      ),
    ).rejects.toThrow("temporary object-store outage");
    expect(
      (
        await database
          .select({ status: schema.files.previewStatus })
          .from(schema.files)
          .where(eq(schema.files.id, readSource.id))
      )[0]?.status,
    ).toBe("pending");

    const storeSource = await sourceFile("retry-store", "image/png");
    await expect(
      worker.runMaterialPreviewJob(
        { fileId: storeSource.id },
        {
          attempt: 1,
          maxAttempts: 2,
          readStorageObject: async () => Uint8Array.from([1, 2, 3]).buffer,
          renderPreview: async () => webp,
          storeFile: async () => {
            throw new Error("temporary preview-store outage");
          },
        },
      ),
    ).rejects.toThrow("temporary preview-store outage");
    expect(
      (
        await database
          .select({ status: schema.files.previewStatus })
          .from(schema.files)
          .where(eq(schema.files.id, storeSource.id))
      )[0]?.status,
    ).toBe("pending");

    const terminal = await worker.runMaterialPreviewJob(
      { fileId: readSource.id },
      {
        attempt: 3,
        maxAttempts: 3,
        readStorageObject: async () => {
          throw new Error("object remains unavailable");
        },
      },
    );
    expect(terminal).toMatchObject({ status: "failed" });
  });

  test("enqueues a strict file-id payload and rearms a failed derivative", async () => {
    const source = await sourceFile("enqueue", "application/pdf");
    await database
      .update(schema.files)
      .set({ previewStatus: "failed" })
      .where(eq(schema.files.id, source.id));
    const job = await worker.enqueueMaterialPreview({
      fileId: source.id,
      userId,
    });
    expect(job).toMatchObject({
      kind: worker.MATERIAL_PREVIEW_JOB_KIND,
      payload: { fileId: source.id },
      idempotencyKey: source.id,
      userId,
    });
    const [updated] = await database
      .select({ previewStatus: schema.files.previewStatus })
      .from(schema.files)
      .where(eq(schema.files.id, source.id));
    expect(updated?.previewStatus).toBe("pending");
  });

  test("backfills stored pending materials with bounded enqueue batches", async () => {
    const source = await sourceFile("backfill", "image/png");
    await expect(worker.enqueuePendingMaterialPreviews(0)).rejects.toThrow(
      "between 1 and 1000",
    );
    const result = await worker.enqueuePendingMaterialPreviews(1_000);
    expect(typeof result.scanned).toBe("number");
    expect(typeof result.enqueued).toBe("number");
    expect(result.failed).toBe(0);
    expect(result.scanned >= 1).toBe(true);
    expect(result.enqueued).toBe(result.scanned);
    const [job] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.idempotencyKey, source.id));
    expect(job).toMatchObject({
      kind: worker.MATERIAL_PREVIEW_JOB_KIND,
      payload: { fileId: source.id },
      userId,
    });
  });

  test("deleteFilePreview severs the edge and removes the provider object once", async () => {
    const source = await sourceFile("lifecycle", "image/webp");
    const [preview] = await database
      .insert(schema.files)
      .values({
        provider: "s3",
        storageKey: `private/preview/${userId}/lifecycle.webp`,
        url: "https://example.invalid/lifecycle.webp",
        mimeType: "image/webp",
        byteSize: webp.byteLength,
        purpose: "preview",
        previewStatus: "unsupported",
        userId,
      })
      .returning();
    if (!preview) throw new Error("Lifecycle preview fixture was not stored");
    await database
      .update(schema.files)
      .set({ previewFileId: preview.id, previewStatus: "ready" })
      .where(eq(schema.files.id, source.id));
    const deletedKeys: string[] = [];
    const { deleteFilePreview } = await import("../lib/storage");
    await deleteFilePreview(userId, source.id, {
      deleteProviderFile: async (storageKey) => {
        deletedKeys.push(storageKey);
        return { success: true, deletedCount: 1 };
      },
    });
    const [updatedSource] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, source.id));
    const [updatedPreview] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, preview.id));
    expect(updatedSource).toMatchObject({
      previewFileId: null,
      previewStatus: "pending",
    });
    expect(updatedPreview?.status).toBe("deleted");
    expect(deletedKeys).toEqual([preview.storageKey]);
  });
});
