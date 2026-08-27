import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import {
  selectOwnedEmbeddingGeneration,
  selectOwnedEmbeddingGenerations,
} from "./embedding-generation-selection";

let client: Client | null = null;

afterEach(() => {
  client?.close();
  client = null;
});

async function fixture() {
  client = createClient({ url: ":memory:" });
  await client.batch(
    [
      `CREATE TABLE content_sources (
        id text PRIMARY KEY NOT NULL,
        userId text NOT NULL
      )`,
      `CREATE TABLE content_versions (
        id text PRIMARY KEY NOT NULL,
        sourceId text NOT NULL
      )`,
      `CREATE TABLE corpus_embedding_generations (
        id text PRIMARY KEY NOT NULL,
        userId text NOT NULL,
        spaceId text NOT NULL,
        state text NOT NULL,
        publicationEpoch integer NOT NULL,
        expectedVersionCount integer NOT NULL,
        indexedVersionCount integer NOT NULL,
        activatedAt integer,
        updatedAt integer NOT NULL
      )`,
      `CREATE TABLE corpus_embedding_generation_versions (
        generationId text NOT NULL,
        versionId text NOT NULL,
        vectorCount integer NOT NULL,
        indexedAt integer
      )`,
    ],
    "write",
  );
  await client.batch(
    [
      {
        sql: "INSERT INTO content_sources (id, userId) VALUES (?, ?), (?, ?)",
        args: ["source-a", "owner-a", "source-b", "owner-b"],
      },
      {
        sql: `INSERT INTO content_versions (id, sourceId)
          VALUES (?, ?), (?, ?), (?, ?)`,
        args: [
          "snapshot-n",
          "source-a",
          "current-n-plus-1",
          "source-a",
          "foreign-version",
          "source-b",
        ],
      },
      {
        sql: `INSERT INTO corpus_embedding_generations
          (id, userId, spaceId, state, publicationEpoch,
           expectedVersionCount, indexedVersionCount, activatedAt, updatedAt)
          VALUES
          ('revoked-newer', 'owner-a', 'space-a', 'superseded', 3, 1, 1, 300, 300),
          ('historical-n', 'owner-a', 'space-a', 'superseded', 4, 1, 1, 200, 250),
          ('active-n-plus-1', 'owner-a', 'space-a', 'active', 4, 1, 1, 400, 400),
          ('foreign-generation', 'owner-b', 'space-a', 'active', 4, 1, 1, 500, 500)`,
      },
      {
        sql: `INSERT INTO corpus_embedding_generation_versions
          (generationId, versionId, vectorCount, indexedAt)
          VALUES
          ('revoked-newer', 'snapshot-n', 30, 300),
          ('historical-n', 'snapshot-n', 30, 200),
          ('active-n-plus-1', 'current-n-plus-1', 30, 400),
          ('foreign-generation', 'foreign-version', 30, 500)`,
      },
    ],
    "write",
  );
  return client;
}

describe("owned embedding generation selection", () => {
  test("uses a same-epoch historical generation for a snapshot and never resurrects it after fence rotation", async () => {
    const database = await fixture();

    await expect(
      selectOwnedEmbeddingGeneration({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 4,
        versionIds: ["snapshot-n"],
      }),
    ).resolves.toBe("historical-n");
    await expect(
      selectOwnedEmbeddingGeneration({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 4,
        versionIds: ["current-n-plus-1"],
      }),
    ).resolves.toBe("active-n-plus-1");
    await expect(
      selectOwnedEmbeddingGeneration({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 4,
      }),
    ).resolves.toBe("active-n-plus-1");

    // Simulates disable + explicit re-enable: the owner fence advances, while
    // the old immutable collections may still await physical deletion.
    await expect(
      selectOwnedEmbeddingGeneration({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 5,
        versionIds: ["snapshot-n"],
      }),
    ).resolves.toBeNull();
    await expect(
      selectOwnedEmbeddingGeneration({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 5,
      }),
    ).resolves.toBeNull();

    // Neither a foreign version nor a foreign owner's active generation can
    // satisfy this owner's immutable-version fence.
    await expect(
      selectOwnedEmbeddingGeneration({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 4,
        versionIds: ["foreign-version"],
      }),
    ).resolves.toBeNull();
  });

  test("selects immutable per-version collections when snapshots came from different rebuilds", async () => {
    const database = await fixture();
    await database.batch(
      [
        {
          sql: "INSERT INTO content_sources (id, userId) VALUES (?, ?)",
          args: ["source-c", "owner-a"],
        },
        {
          sql: "INSERT INTO content_versions (id, sourceId) VALUES (?, ?)",
          args: ["snapshot-from-later-rebuild", "source-c"],
        },
        {
          sql: `INSERT INTO corpus_embedding_generations
            (id, userId, spaceId, state, publicationEpoch,
             expectedVersionCount, indexedVersionCount, activatedAt, updatedAt)
            VALUES
            ('historical-later', 'owner-a', 'space-a', 'superseded', 4,
             1, 1, 350, 350)`,
        },
        {
          sql: `INSERT INTO corpus_embedding_generation_versions
            (generationId, versionId, vectorCount, indexedAt)
            VALUES ('historical-later', 'snapshot-from-later-rebuild', 30, 350)`,
        },
      ],
      "write",
    );

    await expect(
      selectOwnedEmbeddingGenerations({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 4,
        versionIds: ["snapshot-n", "snapshot-from-later-rebuild"],
      }),
    ).resolves.toEqual([
      {
        generationId: "historical-later",
        versionIds: ["snapshot-from-later-rebuild"],
      },
      { generationId: "historical-n", versionIds: ["snapshot-n"] },
    ]);

    // A caller requiring one mutable-looking collection must fail closed. The
    // multi-generation API is the only valid way to serve this exact scope.
    await expect(
      selectOwnedEmbeddingGeneration({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 4,
        versionIds: ["snapshot-n", "snapshot-from-later-rebuild"],
      }),
    ).resolves.toBeNull();
  });

  test("groups compatible snapshots into one complete immutable generation", async () => {
    const database = await fixture();
    await database.batch(
      [
        {
          sql: "INSERT INTO content_sources (id, userId) VALUES (?, ?)",
          args: ["source-c", "owner-a"],
        },
        {
          sql: "INSERT INTO content_versions (id, sourceId) VALUES (?, ?)",
          args: ["snapshot-c", "source-c"],
        },
        {
          sql: `INSERT INTO corpus_embedding_generations
            (id, userId, spaceId, state, publicationEpoch,
             expectedVersionCount, indexedVersionCount, activatedAt, updatedAt)
            VALUES ('historical-grouped', 'owner-a', 'space-a', 'superseded', 4,
              2, 2, 325, 325)`,
        },
        {
          sql: `INSERT INTO corpus_embedding_generation_versions
            (generationId, versionId, vectorCount, indexedAt)
            VALUES ('historical-grouped', 'snapshot-n', 30, 325),
              ('historical-grouped', 'snapshot-c', 30, 325)`,
        },
      ],
      "write",
    );

    await expect(
      selectOwnedEmbeddingGenerations({
        client: database,
        ownerId: "owner-a",
        spaceId: "space-a",
        publicationEpoch: 4,
        versionIds: ["snapshot-n", "snapshot-c"],
      }),
    ).resolves.toEqual([
      {
        generationId: "historical-grouped",
        versionIds: ["snapshot-n", "snapshot-c"],
      },
    ]);
  });
});
