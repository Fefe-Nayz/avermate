import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const testDatabase = join(
  tmpdir(),
  `avermate-podcast-artifact-${process.pid}-${crypto.randomUUID()}.db`,
).replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${testDatabase}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.DISABLE_TTS = "false";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let worker: typeof import("./export-document-artifact");

const userId = "podcast-artifact-user";
const yearId = "podcast-artifact-year";

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client, {
    files: [testDatabase],
  });
  await database.$client.executeMultiple(migration);
  await database.insert(schema.users).values({
    id: userId,
    name: "Podcast student",
    email: "podcast@example.com",
    emailVerified: true,
    role: "user",
    banned: false,
  });
  await database.insert(schema.years).values({
    id: yearId,
    name: "Podcast year",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
    userId,
  });
  worker = await import("./export-document-artifact");
}, 30_000);

afterAll(async () => {
  await database.delete(schema.users).where(eq(schema.users.id, userId));
});

async function podcastFixture(input: {
  label: string;
  revision?: number;
  artifactRevision?: number;
  kind?: "fiche" | "note" | "mindmap";
}) {
  const documentId = `podcast_document_${input.label}_${crypto.randomUUID()}`;
  await database.insert(schema.studyDocuments).values({
    id: documentId,
    kind: input.kind ?? "fiche",
    title: "Suites et limites",
    bodyMarkdown:
      "# Définition\n\nUne suite convergente possède une limite finie.\n\n```ts\nconsole.log('ignored')\n```",
    revision: input.revision ?? 1,
    metaVersion: 1,
    metaJson: {},
    yearId,
    userId,
  });
  const [artifact] = await database
    .insert(schema.documentArtifacts)
    .values({
      documentId,
      kind: "audio",
      variant: "default",
      sourceRevision: input.artifactRevision ?? input.revision ?? 1,
      status: "queued",
      userId,
    })
    .returning();
  if (!artifact) throw new Error("Podcast fixture was not created");
  return { documentId, artifact };
}

async function storePodcast(
  input: Parameters<typeof import("../lib/storage").storeFile>[0],
) {
  expect(input).toMatchObject({ userId, purpose: "document-artifact" });
  expect(input.file.type).toBe("audio/mpeg");
  expect(input.file.name).toEndWith(".mp3");
  expect([...new Uint8Array(await input.file.arrayBuffer())]).toEqual([
    0xff, 0xfb, 0x90, 0x64,
  ]);
  const [stored] = await database
    .insert(schema.files)
    .values({
      provider: "local",
      storageKey: `private/document-artifact/${userId}/${crypto.randomUUID()}.mp3`,
      url: "https://example.invalid/podcast.mp3",
      mimeType: input.file.type,
      byteSize: input.file.size,
      purpose: "document-artifact",
      previewStatus: "unsupported",
      userId,
    })
    .returning();
  if (!stored) throw new Error("Podcast fixture was not stored");
  return stored;
}

describe("podcast document artifact", () => {
  test("turns Markdown into deterministic narration", () => {
    expect(
      worker.narrationTextForDocument({
        title: "Limites",
        bodyMarkdown:
          "---\r\ntitle: metadata\r\n---\r\n# Définition\n\n[Une limite](https://example.com) existe.\n\n```js\nsecret()\n```",
      }),
    ).toBe(
      "Podcast Avermate. Limites. Définition Une limite existe. Extrait de code omis. Fin du document.",
    );
  });

  test("publishes one MP3 for a revision and reuses it idempotently", async () => {
    const fixture = await podcastFixture({ label: "success" });
    let speechCalls = 0;
    const textToSpeech: typeof import("../lib/text-to-speech").runMistralTextToSpeech =
      async (_owner, narration) => {
        speechCalls += 1;
        expect(narration).toContain("Une suite convergente");
        expect(narration).not.toContain("console.log");
        return {
          audio: Uint8Array.from([0xff, 0xfb, 0x90, 0x64]),
          mimeType: "audio/mpeg",
          model: "voxtral-test",
          voiceId: null,
          chunkCount: 1,
          characterCount: narration.length,
        };
      };
    const result = await worker.runExportDocumentArtifactJob(
      { artifactId: fixture.artifact.id },
      { textToSpeech, storeFile: storePodcast },
    );
    expect(result).toMatchObject({
      id: fixture.artifact.id,
      kind: "audio",
      sourceRevision: 1,
    });
    const [published] = await database
      .select()
      .from(schema.documentArtifacts)
      .where(eq(schema.documentArtifacts.id, fixture.artifact.id));
    expect(published).toMatchObject({
      status: "succeeded",
      fileId: result.fileId,
      metaVersion: 1,
      metaJson: {
        provider: "mistral",
        model: "voxtral-test",
        voiceId: null,
        chunkCount: 1,
        aiGenerated: true,
      },
    });

    const reused = await worker.runExportDocumentArtifactJob(
      { artifactId: fixture.artifact.id },
      {
        textToSpeech: async () => {
          throw new Error("idempotent replay must not call TTS");
        },
        storeFile: async () => {
          throw new Error("idempotent replay must not store twice");
        },
      },
    );
    expect(reused).toMatchObject({
      status: "succeeded",
      fileId: result.fileId,
    });
    expect(speechCalls).toBe(1);
  });

  test("fails a stale source revision before spending TTS credits", async () => {
    const fixture = await podcastFixture({
      label: "stale",
      revision: 2,
      artifactRevision: 1,
    });
    let called = false;
    await expect(
      worker.runExportDocumentArtifactJob(
        { artifactId: fixture.artifact.id },
        {
          textToSpeech: async () => {
            called = true;
            throw new Error("must not run");
          },
        },
      ),
    ).rejects.toMatchObject({ name: "NonRetryableJobError" });
    expect(called).toBe(false);
    const [failed] = await database
      .select()
      .from(schema.documentArtifacts)
      .where(eq(schema.documentArtifacts.id, fixture.artifact.id));
    expect(failed).toMatchObject({
      status: "failed",
      fileId: null,
      log: "The source changed before generation; regenerate the current revision",
    });
  });

  test("reclaims a running artifact after the durable job lease is retried", async () => {
    const fixture = await podcastFixture({ label: "crash-recovery" });
    await database
      .update(schema.documentArtifacts)
      .set({
        status: "running",
        metaJson: { generationRunId: "crashed-worker" },
      })
      .where(eq(schema.documentArtifacts.id, fixture.artifact.id));
    const result = await worker.runExportDocumentArtifactJob(
      { artifactId: fixture.artifact.id },
      {
        attempt: 2,
        textToSpeech: async () => ({
          audio: Uint8Array.from([0xff, 0xfb, 0x90, 0x64]),
          mimeType: "audio/mpeg",
          model: "voxtral-test",
          voiceId: null,
          chunkCount: 1,
          characterCount: 50,
        }),
        storeFile: storePodcast,
      },
    );
    expect(result).toMatchObject({
      id: fixture.artifact.id,
      kind: "audio",
    });
    const [published] = await database
      .select()
      .from(schema.documentArtifacts)
      .where(eq(schema.documentArtifacts.id, fixture.artifact.id));
    expect(published).toMatchObject({
      status: "succeeded",
      fileId: result.fileId,
      metaJson: { model: "voxtral-test", aiGenerated: true },
    });
  });

  test("rejects podcast generation for structural document types", async () => {
    const fixture = await podcastFixture({ label: "mindmap", kind: "mindmap" });
    await expect(
      worker.runExportDocumentArtifactJob({ artifactId: fixture.artifact.id }),
    ).rejects.toThrow("only be generated from a sheet or note");
  });
});
