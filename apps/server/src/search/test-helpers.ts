import { createClient, type Client } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migrationSql = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

export async function createCorpusTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "avermate-corpus-test-"));
  const client = createClient({ url: `file:${join(directory, "corpus.db")}` });
  registerSharedTestDatabaseLifecycle(client, { directories: [directory] });
  await client.executeMultiple(migrationSql);
  const now = Math.floor(
    new Date("2026-08-22T00:00:00.000Z").getTime() / 1_000,
  );
  await client.batch(
    [
      {
        sql: `INSERT INTO users (id, name, email, emailVerified, role, banned, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'user', 0, ?, ?)`,
        args: ["corpus-user-a", "Corpus A", "corpus-a@example.test", now, now],
      },
      {
        sql: `INSERT INTO users (id, name, email, emailVerified, role, banned, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'user', 0, ?, ?)`,
        args: ["corpus-user-b", "Corpus B", "corpus-b@example.test", now, now],
      },
      {
        sql: `INSERT INTO years (id, name, startsAt, endsAt, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "corpus-year-a",
          "2026 A",
          now,
          now + 31_536_000,
          "corpus-user-a",
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO years (id, name, startsAt, endsAt, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "corpus-year-b",
          "2026 B",
          now,
          now + 31_536_000,
          "corpus-user-b",
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO subjects (id, name, coefficient, kind, isMain, bonus, sortOrder, yearId, userId, createdAt, updatedAt) VALUES (?, 'Mathématiques', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
        args: ["corpus-subject-a", "corpus-year-a", "corpus-user-a", now, now],
      },
      {
        sql: `INSERT INTO subjects (id, name, coefficient, kind, isMain, bonus, sortOrder, yearId, userId, createdAt, updatedAt) VALUES (?, 'Mathématiques privées', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
        args: ["corpus-subject-b", "corpus-year-b", "corpus-user-b", now, now],
      },
    ],
    "write",
  );
  return client;
}

export async function seedSource(
  client: Client,
  input: {
    id: string;
    ownerId?: string;
    originId?: string;
    originKind?: string;
    yearId?: string;
    subjectId?: string | null;
  },
) {
  const ownerId = input.ownerId ?? "corpus-user-a";
  const now = Math.floor(Date.now() / 1_000);
  await client.execute({
    sql: `
      INSERT INTO content_sources (
        id, userId, yearId, subjectId, originKind, originId, status,
        coverage, placement, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, 'registered', 'searchable-native-text', 'core', ?, ?)
    `,
    args: [
      input.id,
      ownerId,
      input.yearId ??
        (ownerId === "corpus-user-a" ? "corpus-year-a" : "corpus-year-b"),
      input.subjectId === undefined
        ? ownerId === "corpus-user-a"
          ? "corpus-subject-a"
          : "corpus-subject-b"
        : input.subjectId,
      input.originKind ?? "subject",
      input.originId ??
        (ownerId === "corpus-user-a" ? "corpus-subject-a" : "corpus-subject-b"),
      now,
      now,
    ],
  });
}
