import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.STORAGE_DRIVER = "local";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

type AppRouter = typeof import("./index").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let apiA: Api;
let apiB: Api;

const userA = "grade-attachment-user-a";
const userB = "grade-attachment-user-b";
const yearA = "grade-attachment-year-a";
const yearB = "grade-attachment-year-b";
const subjectA = "grade-attachment-subject-a";
const subjectB = "grade-attachment-subject-b";

function sessionFor(id: string) {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      image: null,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date("2027-12-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

async function createGrade(userId = userA) {
  const id = `grade-attachment-${crypto.randomUUID()}`;
  const own = userId === userA;
  await database.insert(schema.grades).values({
    id,
    name: "Written test",
    value: 15,
    outOf: 20,
    passedAt: new Date("2026-10-15T10:00:00.000Z"),
    subjectId: own ? subjectA : subjectB,
    yearId: own ? yearA : yearB,
    userId,
  });
  return id;
}

async function insertStoredAttachment(
  gradeId: string,
  sortOrder = 0,
  label: string | null = null,
) {
  const suffix = crypto.randomUUID();
  const [file] = await database
    .insert(schema.files)
    .values({
      id: `file-${suffix}`,
      storageKey: `grade-copy-test-${suffix}`,
      url: `https://example.invalid/${suffix}.pdf`,
      mimeType: "application/pdf",
      byteSize: 128,
      purpose: "grade-copy",
      provider: "test",
      userId: userA,
    })
    .returning();
  if (!file) throw new Error("Fixture file was not returned");
  const [attachment] = await database
    .insert(schema.gradeAttachments)
    .values({ gradeId, fileId: file.id, label, sortOrder, userId: userA })
    .returning();
  if (!attachment) throw new Error("Fixture attachment was not returned");
  return { file, attachment };
}

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: userA,
        name: "Attachment User A",
        email: "grade-attachment-user-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: "Attachment User B",
        email: "grade-attachment-user-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(schema.years)
    .values([
      {
        id: yearA,
        name: "Attachment year A",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userA,
      },
      {
        id: yearB,
        name: "Attachment year B",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userB,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(schema.subjects)
    .values([
      { id: subjectA, name: "Mathematics", yearId: yearA, userId: userA },
      { id: subjectB, name: "Physics", yearId: yearB, userId: userB },
    ])
    .onConflictDoNothing();

  const { appRouter } = await import("./index");
  apiA = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userA) },
  });
  apiB = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userB) },
  });
});

afterAll(async () => {
  await database
    .delete(schema.gradeAttachments)
    .where(inArray(schema.gradeAttachments.userId, [userA, userB]));
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [userA, userB]));
});

describe("grade copy attachments", () => {
  test("rejects a valid upload when provider storage is disabled", async () => {
    const gradeId = await createGrade();
    await expect(
      apiA.grades.attachCopy({
        gradeId,
        file: new File(["copy"], "copy.pdf", { type: "application/pdf" }),
      }),
    ).rejects.toThrow("Copy uploads are not configured on this server");
  });

  test("returns stored file metadata in stable attachment order", async () => {
    const gradeId = await createGrade();
    const later = await insertStoredAttachment(gradeId, 2, "Second page");
    const first = await insertStoredAttachment(gradeId, 1, "First page");

    const rows = await apiA.grades.attachments({ gradeId });
    expect(rows.map((row) => row.id)).toEqual([
      first.attachment.id,
      later.attachment.id,
    ]);
    expect(rows[0]).toMatchObject({
      label: "First page",
      sortOrder: 1,
      file: {
        id: first.file.id,
        mimeType: "application/pdf",
        byteSize: 128,
      },
    });
  });

  test("never reveals or removes another account's attachment", async () => {
    const gradeId = await createGrade();
    const { attachment } = await insertStoredAttachment(gradeId);
    await expect(apiB.grades.attachments({ gradeId })).rejects.toThrow(
      "Grade not found",
    );
    await expect(
      apiB.grades.removeCopy({ attachmentId: attachment.id }),
    ).rejects.toThrow("Grade attachment not found");
    expect(
      await database
        .select()
        .from(schema.gradeAttachments)
        .where(eq(schema.gradeAttachments.id, attachment.id)),
    ).toHaveLength(1);
  });

  test("caps each grade at ten attachments before starting an upload", async () => {
    const gradeId = await createGrade();
    for (let index = 0; index < 10; index += 1) {
      await insertStoredAttachment(gradeId, index);
    }
    await expect(
      apiA.grades.attachCopy({
        gradeId,
        file: new File(["copy"], "eleventh.pdf", {
          type: "application/pdf",
        }),
      }),
    ).rejects.toThrow("at most 10 copy attachments");
  });

  test("removes the relation and soft-deletes its provider file", async () => {
    const gradeId = await createGrade();
    const { file, attachment } = await insertStoredAttachment(gradeId);
    expect(
      await apiA.grades.removeCopy({ attachmentId: attachment.id }),
    ).toEqual({
      ok: true,
    });
    expect(
      await database
        .select()
        .from(schema.gradeAttachments)
        .where(eq(schema.gradeAttachments.id, attachment.id)),
    ).toHaveLength(0);
    const [stored] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, file.id));
    expect(stored?.status).toBe("deleted");
  });

  test("deleting a grade cascades relations and soft-deletes every copy", async () => {
    const gradeId = await createGrade();
    const first = await insertStoredAttachment(gradeId, 0);
    const second = await insertStoredAttachment(gradeId, 1);
    expect(await apiA.grades.delete({ gradeId })).toEqual({ ok: true });
    expect(
      await database
        .select()
        .from(schema.gradeAttachments)
        .where(eq(schema.gradeAttachments.gradeId, gradeId)),
    ).toHaveLength(0);
    const stored = await database
      .select({ id: schema.files.id, status: schema.files.status })
      .from(schema.files)
      .where(inArray(schema.files.id, [first.file.id, second.file.id]));
    expect(stored).toHaveLength(2);
    expect(stored.every((file) => file.status === "deleted")).toBe(true);
  });

  test("enforces one relation per grade and file", async () => {
    const gradeId = await createGrade();
    const { file } = await insertStoredAttachment(gradeId);
    await expect(
      Promise.resolve().then(async () => {
        await database.insert(schema.gradeAttachments).values({
          gradeId,
          fileId: file.id,
          userId: userA,
        });
      }),
    ).rejects.toThrow();
    expect(
      await database
        .select()
        .from(schema.gradeAttachments)
        .where(
          and(
            eq(schema.gradeAttachments.gradeId, gradeId),
            eq(schema.gradeAttachments.fileId, file.id),
          ),
        ),
    ).toHaveLength(1);
  });
});
