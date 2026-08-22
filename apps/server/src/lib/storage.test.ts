import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-storage-"));
const databasePath = join(testDirectory, "storage.db").replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "false";
process.env.DISABLE_JOBS = "true";
delete process.env.STORAGE_DRIVER;
process.env.LOCAL_UPLOAD_DIR = join(testDirectory, "uploads");

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let storage: typeof import("./storage");
let storageBackend: typeof import("./storage-backend");
let ownership: typeof import("./ownership");

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client, {
    directories: [testDirectory],
  });
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  storage = await import("./storage");
  storageBackend = await import("./storage-backend");
  ownership = await import("./ownership");
  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: "storage-user-a",
        name: "Storage User A",
        email: "storage-user-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "storage-user-b",
        name: "Storage User B",
        email: "storage-user-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "storage-user-delete",
        name: "Storage Delete User",
        email: "storage-user-delete@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  await database
    .delete(schema.files)
    .where(like(schema.files.storageKey, "storage-test-%"));
}, 30_000);

describe("shared file storage", () => {
  test("defaults to zero-config local storage outside production", () => {
    expect(storageBackend.storageDriver()).toBe("local");
    expect(storage.storageEnabled()).toBe(true);
  });

  test("honours the explicit upload kill switch", async () => {
    process.env.DISABLE_UPLOADS = "true";
    try {
      expect(storage.storageEnabled()).toBe(false);
      await expect(
        storage.storeFile({
          userId: "storage-user-b",
          purpose: "avatar",
          file: new File([new Uint8Array([1, 2, 3])], "avatar.png", {
            type: "image/png",
          }),
        }),
      ).rejects.toThrow("Avatar uploads are not configured on this server");
    } finally {
      process.env.DISABLE_UPLOADS = "false";
    }
  });

  test("stores, verifies and deletes objects locally without external setup", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], "avatar.png", { type: "image/png" });
    const stored = await storage.storeFile({
      userId: "storage-user-b",
      purpose: "avatar",
      file,
    });
    expect(stored.provider).toBe("local");
    await expect(
      storageBackend.headStorageObject("local", stored.storageKey),
    ).resolves.toEqual({
      byteSize: bytes.byteLength,
      mimeType: null,
    });
    expect(
      new Uint8Array(
        await storageBackend.readStorageObject("local", stored.storageKey, {
          maxBytes: bytes.byteLength,
        }),
      ),
    ).toEqual(bytes);
    await expect(
      storageBackend.readStorageObject("local", stored.storageKey, {
        maxBytes: bytes.byteLength - 1,
      }),
    ).rejects.toThrow("read limit");
    await storage.deleteFile("storage-user-b", stored.id);
    await expect(
      storageBackend.headStorageObject("local", stored.storageKey),
    ).rejects.toThrow();
  });

  test("validates size and MIME type before touching the provider", async () => {
    await expect(
      storage.storeFile({
        userId: "storage-user-a",
        purpose: "avatar",
        file: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      }),
    ).rejects.toThrow("That image is too large");
    await expect(
      storage.storeFile({
        userId: "storage-user-a",
        purpose: "feedback-attachment",
        file: new File(["not an image"], "notes.txt", { type: "text/plain" }),
      }),
    ).rejects.toThrow("Only PNG, JPEG and WebP feedback images are supported");
    expect(() =>
      storage.validateFileForPurpose(
        "course-material",
        new File(["docx"], "lesson.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    ).not.toThrow();
    expect(
      storage.validateFileForPurpose(
        "course-material",
        new File(["markdown"], "notes.md"),
      ),
    ).toBe("text/markdown");
    expect(
      storage.validateFileForPurpose(
        "course-material",
        new File(["sheet"], "marks.xlsx", {
          type: "application/octet-stream",
        }),
      ),
    ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(() =>
      storage.validateFileForPurpose(
        "course-material",
        new File(["binary"], "installer.exe", {
          type: "application/vnd.microsoft.portable-executable",
        }),
      ),
    ).toThrow("Microsoft Office and OpenDocument");
  });

  test("declares constraints for every current file purpose", () => {
    expect(Object.keys(storage.FILE_CONSTRAINTS).sort()).toEqual([
      "avatar",
      "course-material",
      "course-media",
      "document-artifact",
      "document-export",
      "feedback-attachment",
      "grade-copy",
      "latex-build",
      "lecture-audio-segment",
      "preview",
    ]);
    expect(storage.FILE_CONSTRAINTS["lecture-audio-segment"]).toEqual({
      maxBytes: 32 * 1024 * 1024,
      mimeTypes: ["audio/mp4", "audio/m4a", "audio/webm", "audio/ogg"],
    });
    expect(storage.FILE_CONSTRAINTS["course-material"].mimeTypes).toEqual(
      expect.arrayContaining([
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.oasis.opendocument.text",
        "text/plain",
      ]),
    );
    expect(storage.fileAclForPurpose("course-material")).toBe("private");
    expect(storage.fileAclForPurpose("lecture-audio-segment")).toBe("private");
    expect(storage.fileAclForPurpose("grade-copy")).toBe("private");
    expect(storage.fileAclForPurpose("document-export")).toBe("private");
    expect(storage.fileAclForPurpose("avatar")).toBe("public-read");
  });

  test("enforces a persistent per-account course-material quota", async () => {
    const first = await storage.recordStoredFile(
      {
        provider: "test",
        storageKey: `storage-test-quota-${crypto.randomUUID()}`,
        url: "https://example.invalid/quota-first.pdf",
        mimeType: "application/pdf",
        byteSize: 8,
        purpose: "course-material",
        userId: "storage-user-a",
      },
      { database, courseMaterialQuotaBytes: 10 },
    );
    await expect(
      storage.recordStoredFile(
        {
          provider: "test",
          storageKey: `storage-test-quota-${crypto.randomUUID()}`,
          url: "https://example.invalid/quota-second.pdf",
          mimeType: "application/pdf",
          byteSize: 3,
          purpose: "course-material",
          userId: "storage-user-a",
        },
        { database, courseMaterialQuotaBytes: 10 },
      ),
    ).rejects.toThrow("5 GiB per account");
    await database
      .update(schema.files)
      .set({ status: "deleted" })
      .where(eq(schema.files.id, first.id));
    await expect(
      storage.recordStoredFile(
        {
          provider: "test",
          storageKey: `storage-test-quota-${crypto.randomUUID()}`,
          url: "https://example.invalid/quota-second.pdf",
          mimeType: "application/pdf",
          byteSize: 3,
          purpose: "course-material",
          userId: "storage-user-a",
        },
        { database, courseMaterialQuotaBytes: 10 },
      ),
    ).resolves.toMatchObject({ byteSize: 3, status: "stored" });
  }, 30_000);

  test("enforces an independent persistent LaTeX-build quota", async () => {
    const first = await storage.recordStoredFile(
      {
        provider: "test",
        storageKey: `storage-test-latex-quota-${crypto.randomUUID()}`,
        url: "https://example.invalid/latex-first.pdf",
        mimeType: "application/pdf",
        byteSize: 8,
        purpose: "latex-build",
        userId: "storage-user-a",
      },
      { database, latexBuildQuotaBytes: 10 },
    );
    await expect(
      storage.recordStoredFile(
        {
          provider: "test",
          storageKey: `storage-test-latex-quota-${crypto.randomUUID()}`,
          url: "https://example.invalid/latex-second.pdf",
          mimeType: "application/pdf",
          byteSize: 3,
          purpose: "latex-build",
          userId: "storage-user-a",
        },
        { database, latexBuildQuotaBytes: 10 },
      ),
    ).rejects.toThrow("512 MiB per account");
    await database
      .update(schema.files)
      .set({ status: "deleted" })
      .where(eq(schema.files.id, first.id));
  }, 30_000);

  test("requireFile never reveals a file owned by another account", async () => {
    const [file] = await database
      .insert(schema.files)
      .values({
        storageKey: `storage-test-${crypto.randomUUID()}`,
        url: "https://example.invalid/file.png",
        mimeType: "image/png",
        byteSize: 10,
        purpose: "avatar",
        userId: "storage-user-a",
      })
      .returning();
    expect(file).toBeDefined();
    await expect(
      ownership.requireFile("storage-user-b", file!.id),
    ).rejects.toThrow("File not found");
    expect((await ownership.requireFile("storage-user-a", file!.id)).id).toBe(
      file!.id,
    );
  });

  test("removes every provider ledger before an account can cascade it away", async () => {
    const rows = await database
      .insert(schema.files)
      .values([
        {
          provider: "test",
          storageKey: `storage-test-account-${crypto.randomUUID()}`,
          url: "https://example.invalid/account-a.pdf",
          mimeType: "application/pdf",
          byteSize: 10,
          purpose: "course-material",
          userId: "storage-user-delete",
        },
        {
          provider: "test",
          storageKey: `storage-test-account-${crypto.randomUUID()}`,
          url: "https://example.invalid/account-b.pdf",
          mimeType: "application/pdf",
          byteSize: 10,
          purpose: "course-material",
          userId: "storage-user-delete",
        },
      ])
      .returning({ id: schema.files.id });

    expect(await storage.deleteAllUserFiles("storage-user-delete")).toEqual({
      deletedCount: 2,
    });
    const statuses = await database
      .select({ id: schema.files.id, status: schema.files.status })
      .from(schema.files)
      .where(
        and(
          eq(schema.files.userId, "storage-user-delete"),
          like(schema.files.storageKey, "storage-test-account-%"),
        ),
      );
    expect(statuses).toEqual(
      expect.arrayContaining(
        rows.map((row) => ({ id: row.id, status: "deleted" })),
      ),
    );
  });

  test("keeps a failed managed deletion retryable and accepts an already-absent object", async () => {
    const [file] = await database
      .insert(schema.files)
      .values({
        storageKey: `storage-test-${crypto.randomUUID()}`,
        url: "https://example.invalid/remote.pdf",
        mimeType: "application/pdf",
        byteSize: 10,
        purpose: "course-material",
        provider: "s3",
        userId: "storage-user-a",
      })
      .returning();
    expect(file).toBeDefined();

    const deferred = await storage.deleteFile("storage-user-a", file!.id, {
      deleteProviderFile: null,
    });
    expect(deferred.status).toBe("stored");
    expect(
      (await ownership.requireFile("storage-user-a", file!.id)).status,
    ).toBe("stored");
    const [cleanup] = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "cleanup.unownedFile"),
          eq(schema.jobs.userId, "storage-user-a"),
        ),
      );
    expect(cleanup).toMatchObject({
      status: "queued",
      maxAttempts: 6,
      payload: { userId: "storage-user-a", fileId: file!.id },
    });

    await expect(
      storage.deleteFile("storage-user-a", file!.id, {
        deleteProviderFile: null,
        deferOnProviderFailure: false,
      }),
    ).rejects.toThrow("deletion is not configured");
    await expect(
      storage.deleteFile("storage-user-a", file!.id, {
        deleteProviderFile: async () => ({ success: false, deletedCount: 0 }),
        deferOnProviderFailure: false,
      }),
    ).rejects.toThrow("did not confirm deletion");
    expect(
      (await ownership.requireFile("storage-user-a", file!.id)).status,
    ).toBe("stored");

    let providerCalls = 0;
    const deleted = await storage.deleteFile("storage-user-a", file!.id, {
      deleteProviderFile: async () => {
        providerCalls += 1;
        return { success: true, deletedCount: 0 };
      },
    });
    expect(deleted.status).toBe("deleted");
    expect(providerCalls).toBe(1);

    const replay = await storage.deleteFile("storage-user-a", file!.id, {
      deleteProviderFile: async () => {
        throw new Error("A deleted row must not call storage again");
      },
    });
    expect(replay.status).toBe("deleted");
    expect(providerCalls).toBe(1);
  });

  test("retries upload compensation and never treats success:false as deleted", async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      storage.compensateProviderUpload("storage-test-compensation", {
        maxAttempts: 6,
        sleep: async (delay) => {
          delays.push(delay);
        },
        deleteProviderFile: async () => {
          calls += 1;
          if (calls < 6) return { success: false, deletedCount: 0 };
          return { success: true, deletedCount: 0 };
        },
      }),
    ).resolves.toEqual({ success: true, deletedCount: 0 });
    expect(calls).toBe(6);
    expect(delays).toEqual([250, 500, 1_000, 2_000, 2_000]);

    calls = 0;
    await expect(
      storage.compensateProviderUpload("storage-test-compensation-failure", {
        maxAttempts: 6,
        sleep: async () => undefined,
        deleteProviderFile: async () => {
          calls += 1;
          throw new Error("provider unavailable");
        },
      }),
    ).rejects.toThrow("provider unavailable");
    expect(calls).toBe(6);
  });

  test("times out a suspended provider deletion without losing retryability", async () => {
    const [file] = await database
      .insert(schema.files)
      .values({
        storageKey: `storage-test-timeout-${crypto.randomUUID()}`,
        url: "https://example.invalid/suspended.pdf",
        mimeType: "application/pdf",
        byteSize: 10,
        purpose: "course-material",
        provider: "s3",
        userId: "storage-user-a",
      })
      .returning();
    let calls = 0;
    const deferred = await storage.deleteFile("storage-user-a", file!.id, {
      providerTimeoutMs: 5,
      deleteProviderFile: async () => {
        calls += 1;
        return new Promise<never>(() => undefined);
      },
    });
    expect(deferred.status).toBe("stored");
    expect(calls).toBe(1);
    expect(
      (await ownership.requireFile("storage-user-a", file!.id)).status,
    ).toBe("stored");
    const cleanupRows = await database
      .select({ payload: schema.jobs.payload, status: schema.jobs.status })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "cleanup.unownedFile"),
          eq(schema.jobs.userId, "storage-user-a"),
        ),
      );
    expect(
      cleanupRows.some(
        (job) =>
          job.status === "queued" &&
          (job.payload as { fileId?: unknown } | null)?.fileId === file!.id,
      ),
    ).toBe(true);

    await expect(
      storage.deleteFile("storage-user-a", file!.id, {
        providerTimeoutMs: 5,
        deferOnProviderFailure: false,
        deleteProviderFile: async () => new Promise<never>(() => undefined),
      }),
    ).rejects.toThrow("deletion timed out");
    expect(
      (await ownership.requireFile("storage-user-a", file!.id)).status,
    ).toBe("stored");

    calls = 0;
    await expect(
      storage.compensateProviderUpload("storage-test-suspended-compensation", {
        maxAttempts: 2,
        timeoutMs: 5,
        sleep: async () => undefined,
        deleteProviderFile: async () => {
          calls += 1;
          return new Promise<never>(() => undefined);
        },
      }),
    ).rejects.toThrow("deletion timed out");
    expect(calls).toBe(2);
  });

  test("extracts only legacy provider file keys", () => {
    expect(storage.legacyKeyOf("https://example.ufs.sh/f/a-key_123")).toBe(
      "a-key_123",
    );
    expect(storage.legacyKeyOf("https://example.com/not-a-file")).toBeNull();
    expect(storage.legacyKeyOf(null)).toBeNull();
  });
});
