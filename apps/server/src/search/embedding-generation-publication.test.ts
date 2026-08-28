import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desiredEmbeddingGenerationVersionIds,
  embeddingVersionSetDigest,
  publishCompletedEmbeddingGeneration,
} from "./embedding-generation-publication";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

let client: Client;
let directory: string;
const ownerId = "publication-owner";
const spaceId = "publication-space";
const publicationEpoch = 7;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "embedding-publication-test-"));
  client = createClient({ url: `file:${join(directory, "test.db")}` });
  registerSharedTestDatabaseLifecycle(client, { directories: [directory] });
  await client.executeMultiple(`
    CREATE TABLE corpus_embedding_owner_states (
      userId TEXT PRIMARY KEY,
      publicationEpoch INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE study_projects (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      deletedAt INTEGER,
      retrievalMode TEXT NOT NULL,
      embeddingSpaceId TEXT
    );
    CREATE TABLE study_project_items (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      kind TEXT NOT NULL,
      referenceId TEXT NOT NULL,
      trackingMode TEXT NOT NULL,
      sourceVersionId TEXT,
      contextMode TEXT NOT NULL,
      selectorReviewRequired INTEGER NOT NULL
    );
    CREATE TABLE content_sources (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      originKind TEXT NOT NULL,
      originId TEXT NOT NULL,
      currentVersionId TEXT,
      placement TEXT NOT NULL
    );
    CREATE TABLE content_versions (
      id TEXT PRIMARY KEY,
      sourceId TEXT NOT NULL
    );
    CREATE TABLE corpus_embedding_generations (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      spaceId TEXT NOT NULL,
      state TEXT NOT NULL,
      publicationEpoch INTEGER NOT NULL,
      versionSetDigest TEXT NOT NULL,
      expectedVersionCount INTEGER NOT NULL,
      indexedVersionCount INTEGER NOT NULL,
      activatedAt INTEGER,
      errorCode TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX corpus_embedding_generations_active_unique
      ON corpus_embedding_generations(userId, spaceId)
      WHERE state = 'active';
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT,
      payloadVersion INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      maxAttempts INTEGER NOT NULL DEFAULT 3,
      runAt INTEGER NOT NULL,
      lockedUntil INTEGER,
      lockedBy TEXT,
      idempotencyKey TEXT,
      result TEXT,
      error TEXT,
      userId TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX jobs_user_kind_key_unique
      ON jobs(userId, kind, idempotencyKey)
      WHERE userId IS NOT NULL AND idempotencyKey IS NOT NULL;
  `);
  await client.batch(
    [
      {
        sql: `INSERT INTO corpus_embedding_owner_states
            (userId, publicationEpoch, enabled, updatedAt)
          VALUES (?, ?, 1, 1)`,
        args: [ownerId, publicationEpoch],
      },
      {
        sql: `INSERT INTO study_projects
            (id, userId, deletedAt, retrievalMode, embeddingSpaceId)
          VALUES ('project-a', ?, NULL, 'advanced-auto', ?)`,
        args: [ownerId, spaceId],
      },
      {
        sql: `INSERT INTO content_sources
            (id, userId, originKind, originId, currentVersionId, placement)
          VALUES ('source-1', ?, 'material', 'material-1', 'version-1', 'core')`,
        args: [ownerId],
      },
      {
        sql: `INSERT INTO content_versions (id, sourceId)
          VALUES ('version-1', 'source-1')`,
        args: [],
      },
      {
        sql: `INSERT INTO study_project_items
            (id, projectId, kind, referenceId, trackingMode,
             sourceVersionId, contextMode, selectorReviewRequired)
          VALUES ('item-1', 'project-a', 'material', 'material-1',
            'follow-head', NULL, 'include', 0)`,
        args: [],
      },
    ],
    "write",
  );
});

afterEach(() => {
  client.close();
});

const scope = {
  ownerId,
  scope: "advanced-projects" as const,
  publicationEpoch,
};

async function addSecondVersionToDesiredCorpus() {
  await client.batch(
    [
      {
        sql: `INSERT INTO content_sources
            (id, userId, originKind, originId, currentVersionId, placement)
          VALUES ('source-2', ?, 'material', 'material-2', 'version-2', 'core')`,
        args: [ownerId],
      },
      {
        sql: `INSERT INTO content_versions (id, sourceId)
          VALUES ('version-2', 'source-2')`,
        args: [],
      },
      {
        sql: `INSERT INTO study_project_items
            (id, projectId, kind, referenceId, trackingMode,
             sourceVersionId, contextMode, selectorReviewRequired)
          VALUES ('item-2', 'project-a', 'material', 'material-2',
            'follow-head', NULL, 'include', 0)`,
        args: [],
      },
    ],
    "write",
  );
}

async function insertCompleteGeneration(input: {
  id: string;
  state: "staging" | "active";
  versionIds: readonly string[];
  activatedAt?: number | null;
}) {
  await client.execute({
    sql: `INSERT INTO corpus_embedding_generations
        (id, userId, spaceId, state, publicationEpoch, versionSetDigest,
         expectedVersionCount, indexedVersionCount, activatedAt,
         createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    args: [
      input.id,
      ownerId,
      spaceId,
      input.state,
      publicationEpoch,
      embeddingVersionSetDigest(input.versionIds),
      input.versionIds.length,
      input.versionIds.length,
      input.activatedAt ?? null,
    ],
  });
}

describe("embedding generation publication", () => {
  test("a stale S1 rebuild cannot supersede the newer active S1+S2 generation", async () => {
    await insertCompleteGeneration({
      id: "generation-a",
      state: "staging",
      versionIds: ["version-1"],
    });

    await addSecondVersionToDesiredCorpus();
    const currentVersionIds = await desiredEmbeddingGenerationVersionIds(
      client,
      scope,
      spaceId,
    );
    expect(currentVersionIds).toEqual(["version-1", "version-2"]);
    await insertCompleteGeneration({
      id: "generation-b",
      state: "active",
      versionIds: currentVersionIds,
      activatedAt: 2,
    });

    const transaction = await client.transaction("write");
    const publication = await publishCompletedEmbeddingGeneration({
      transaction,
      scope,
      generationId: "generation-a",
      spaceId,
      publicationEpoch,
      now: 3,
    });
    await transaction.commit();

    expect(publication).toEqual({
      status: "superseded",
      reason: "version-set-changed",
      desiredVersionSetDigest: embeddingVersionSetDigest([
        "version-1",
        "version-2",
      ]),
      desiredVersionCount: 2,
      activeGenerationId: "generation-b",
      rebuildJobId: null,
    });
    const rows = await client.execute({
      sql: `SELECT id, state, activatedAt
        FROM corpus_embedding_generations ORDER BY id`,
      args: [],
    });
    expect(
      rows.rows.map((row) => ({
        id: String(row.id),
        state: String(row.state),
        activatedAt: row.activatedAt === null ? null : Number(row.activatedAt),
      })),
    ).toEqual([
      { id: "generation-a", state: "superseded", activatedAt: null },
      { id: "generation-b", state: "active", activatedAt: 2 },
    ]);
    const jobs = await client.execute("SELECT id FROM jobs");
    expect(jobs.rows).toHaveLength(0);
  });

  test("stale publishers queue one idempotent rebuild when the current digest is not active", async () => {
    for (const id of ["generation-a", "generation-c"]) {
      await insertCompleteGeneration({
        id,
        state: "staging",
        versionIds: ["version-1"],
      });
    }
    await addSecondVersionToDesiredCorpus();

    const rebuildJobIds: Array<string | null> = [];
    for (const [index, generationId] of [
      "generation-a",
      "generation-c",
    ].entries()) {
      const transaction = await client.transaction("write");
      const publication = await publishCompletedEmbeddingGeneration({
        transaction,
        scope,
        generationId,
        spaceId,
        publicationEpoch,
        now: 3 + index,
      });
      await transaction.commit();
      expect(publication.status).toBe("superseded");
      if (publication.status === "superseded") {
        rebuildJobIds.push(publication.rebuildJobId);
      }
    }

    expect(rebuildJobIds[0]).toBeString();
    expect(rebuildJobIds[1]).toBe(rebuildJobIds[0]);
    const jobs = await client.execute({
      sql: `SELECT id, status, payload, idempotencyKey FROM jobs`,
      args: [],
    });
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]).toMatchObject({
      id: rebuildJobIds[0],
      status: "queued",
    });
    expect(String(jobs.rows[0]?.idempotencyKey)).toContain(
      embeddingVersionSetDigest(["version-1", "version-2"]),
    );
    expect(JSON.parse(String(jobs.rows[0]?.payload))).toEqual({
      ownerId,
      scope: "advanced-projects",
      publicationEpoch,
    });
  });
});
