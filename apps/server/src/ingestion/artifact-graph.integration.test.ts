import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client, type Transaction } from "@libsql/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";

const digest = "d".repeat(64);
let client: Client;
let store: import("./artifact-graph").CoreArtifactGraphStore;
// Applying the migration history through 0059 and releasing its relational
// fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const directory = join(import.meta.dir, "../../drizzle");
  const migrations = readdirSync(directory)
    .filter((file) => /^\d+.*\.sql$/u.test(file))
    .filter((file) => Number.parseInt(file.slice(0, 4), 10) <= 59)
    .sort((left, right) => left.localeCompare(right))
    .map((file) => readFileSync(join(directory, file), "utf8"))
    .join("\n");
  await client.executeMultiple(migrations);
  await client.execute({
    sql: `INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
    args: ["user-1", "User", "user@example.com", 1, 1],
  });
  const module = await import("./artifact-graph");
  // libsql opens a different database connection for `transaction()` on
  // `file::memory:`. Keep the fixture on the same connection; production and
  // file-backed integration paths still use the real transaction API.
  store = new module.CoreArtifactGraphStore({
    execute: (statement) => client.execute(statement),
    transaction: async () =>
      ({
        execute: (statement: Parameters<Client["execute"]>[0]) =>
          client.execute(statement),
        commit: async () => undefined,
        rollback: async () => undefined,
      }) as unknown as Transaction,
  } as Pick<Client, "execute" | "transaction">);
}, databaseHookTimeout);

afterAll(() => client.close(), databaseHookTimeout);

describe("core artifact graph", () => {
  test("plans idempotently, publishes immutable revisions and promotes by CAS", async () => {
    const planned = await store.plan({
      ownerId: "user-1",
      kind: "image",
      title: "Diagram",
      placement: "core",
      policyRef: "advanced-media.v1",
      idempotencyKey: "diagram-plan",
    });
    const replay = await store.plan({
      ownerId: "user-1",
      kind: "image",
      title: "Diagram",
      placement: "core",
      policyRef: "advanced-media.v1",
      idempotencyKey: "diagram-plan",
    });
    expect(replay.id).toBe(planned.id);
    expect(replay.artifactId).toBe(planned.artifactId);

    const published = await store.publishRevision({
      ownerId: "user-1",
      artifactId: planned.artifactId,
      workflowRunId: planned.id,
      renderer: {
        profile: "fixture.image.v1",
        imageDigest: `sha256:${"e".repeat(64)}`,
        toolVersions: { fixture: "1" },
        reproducibility: "full",
      },
      output: { digest, bytes: 1, mime: "image/png" },
    });
    await store.promote({
      ownerId: "user-1",
      artifactId: planned.artifactId,
      artifactRevisionId: published.artifactRevisionId,
      expectedIdentityRevision: 1,
    });
    const historical = await store.getManifest(
      "user-1",
      published.artifactRevisionId,
    );
    expect(historical.digest).toBe(published.manifestDigest);

    const regenerated = await store.publishRevision({
      ownerId: "user-1",
      artifactId: planned.artifactId,
      workflowRunId: planned.id,
      renderer: {
        profile: "fixture.image.v2",
        imageDigest: `sha256:${"f".repeat(64)}`,
        toolVersions: { fixture: "2" },
        reproducibility: "full",
      },
      output: { digest: "c".repeat(64), bytes: 2, mime: "image/png" },
    });
    await store.promote({
      ownerId: "user-1",
      artifactId: planned.artifactId,
      artifactRevisionId: regenerated.artifactRevisionId,
      expectedIdentityRevision: 2,
    });
    expect(
      await store.getManifest("user-1", published.artifactRevisionId),
    ).toEqual(historical);
    expect(
      (await store.getManifest("user-1", regenerated.artifactRevisionId))
        .manifest.output.digest,
    ).toBe("c".repeat(64));
    await expect(
      client.execute({
        sql: `UPDATE generated_artifact_revisions SET outputMime = 'text/plain' WHERE id = ?`,
        args: [published.artifactRevisionId],
      }),
    ).rejects.toThrow(/immutable/u);
  });

  test("stores a typed video timeline and prevents graph cycles", async () => {
    const image = (await store.list("user-1"))[0]!;
    const imageRevisionId = image.currentRevisionId!;
    const imageManifest = await store.getManifest("user-1", imageRevisionId);
    const timelinePlan = await store.plan({
      ownerId: "user-1",
      kind: "video-timeline",
      title: "Lesson video timeline",
      parentArtifactRevisionIds: [imageRevisionId],
      placement: "core",
      policyRef: "advanced-media.v1",
      idempotencyKey: "timeline-plan",
    });
    const published = await store.publishRevision({
      ownerId: "user-1",
      artifactId: timelinePlan.artifactId,
      workflowRunId: timelinePlan.id,
      parentArtifactRevisionIds: [imageRevisionId],
      renderer: {
        profile: "timeline.manifest.v1",
        imageDigest: null,
        toolVersions: { canonicalizer: "1" },
        reproducibility: "full",
      },
      output: {
        digest: "f".repeat(64),
        mime: "application/vnd.avermate.video-timeline+json",
      },
      timeline: {
        schemaVersion: 1,
        width: 1_920,
        height: 1_080,
        fps: 30,
        scenes: [
          {
            id: "scene-1",
            startMs: 0,
            durationMs: 1_000,
            visual: {
              artifactRevisionId: imageRevisionId,
              digest: imageManifest.manifest.output.digest,
              pageOrSlide: 1,
            },
            captions: [],
            transition: "cut",
            citations: [],
          },
        ],
      },
    });
    const stored = await client.execute({
      sql: `SELECT durationMs FROM video_timeline_manifests WHERE artifactRevisionId = ?`,
      args: [published.artifactRevisionId],
    });
    expect(Number(stored.rows[0]?.durationMs)).toBe(1_000);
    await expect(
      client.execute({
        sql: `INSERT INTO artifact_revision_parents (artifactRevisionId, parentArtifactRevisionId) VALUES (?, ?)`,
        args: [imageRevisionId, published.artifactRevisionId],
      }),
    ).rejects.toThrow(/acyclic/u);
  });
});
