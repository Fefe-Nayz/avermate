import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import type {
  LexicalVersionInput,
  NodeLexicalSearchTransport,
  StagedContentVersion,
} from "@avermate/agent-contracts";
import { CoreCorpusStore } from "./core-corpus-store";
import {
  createCoreSourceRegistry,
  IndexableSourceRegistry,
  type IndexableSourceAdapter,
} from "./adapters";
import { CoreCitationResolver } from "./citations";
import { RETRIEVAL_EVALUATION_028 } from "./fixtures/evaluation-028";
import { CorpusIndexService } from "./index-service";
import { lexicalCursor, SqliteFts5LexicalSearchBackend } from "./lexical";
import { createCorpusTestDatabase, seedSource } from "./test-helpers";
import { normalizeForSearch, sha256 } from "./values";
import { InMemoryVectorIndex, reciprocalRankFusion } from "./vector";
import { RoutedCorpusStore } from "./routed-corpus-store";
import { RoutedCorpusContentReader } from "./corpus-content-reader";

let client: Client;
let store: CoreCorpusStore;

const ownerId = "corpus-user-a";
const sourceId = "corpus-source-core";
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

function staged(versionKey: string, text: string): StagedContentVersion {
  return {
    identity: {
      ownerId,
      originKind: "subject",
      originId: "corpus-subject-a",
    },
    sourceId,
    versionKey,
    contentHash: sha256(text),
    extractorId: "test",
    extractorVersion: "1",
    mimeType: "text/plain",
    language: "fr",
    byteSize: text.length,
    locatorSchemaVersion: 1,
    metadata: { fixture: true },
    chunks: [
      {
        ordinal: 0,
        text,
        normalizedText: normalizeForSearch(text),
        tokenEstimate: 4,
        contentHash: sha256(text),
        locator: { kind: "text", startOffset: 0, endOffset: text.length },
        headingPath: null,
        evidenceKind: "native-text",
      },
    ],
  };
}

beforeAll(async () => {
  client = await createCorpusTestDatabase();
  store = new CoreCorpusStore(client);
  await seedSource(client, { id: sourceId });
}, databaseHookTimeout);

afterAll(() => client.close(), databaseHookTimeout);

describe("CoreCorpusStore placement conformance", () => {
  test("stages durably and publishes pointer plus FTS atomically", async () => {
    const stage = await store.stageVersion(
      staged("v1", "Théorème de Pythagore"),
    );
    const before = await store.getSource({
      ownerId,
      originKind: "subject",
      originId: "corpus-subject-a",
    });
    expect(before?.currentVersionId).toBeNull();

    const committed = await store.commitVersion({
      ownerId,
      stagingId: stage.stagingId,
      expectedSourceId: sourceId,
      expectedPreviousVersionId: null,
    });
    const after = await store.getSource({
      ownerId,
      originKind: "subject",
      originId: "corpus-subject-a",
    });
    expect(after?.currentVersionId).toBe(committed.versionId);
    const fts = await client.execute({
      sql: `SELECT chunkId FROM content_chunks_fts WHERE versionId = ?`,
      args: [committed.versionId],
    });
    expect(fts.rows).toHaveLength(1);
  });

  test("rejects stale pointer publication and leaves the old version current", async () => {
    const first = await store.getSource({
      ownerId,
      originKind: "subject",
      originId: "corpus-subject-a",
    });
    const stage = await store.stageVersion(staged("v2", "Fonction affine"));
    await expect(
      store.commitVersion({
        ownerId,
        stagingId: stage.stagingId,
        expectedSourceId: sourceId,
        expectedPreviousVersionId: null,
      }),
    ).rejects.toThrow("changed");
    const after = await store.getSource({
      ownerId,
      originKind: "subject",
      originId: "corpus-subject-a",
    });
    expect(after?.currentVersionId).toBe(first?.currentVersionId);
    const leaked = await client.execute({
      sql: `SELECT id FROM content_versions WHERE versionKey = 'v2'`,
      args: [],
    });
    expect(leaked.rows).toHaveLength(0);
  });

  test("enforces immutable versions and chunks in SQLite", async () => {
    const source = await store.getSource({
      ownerId,
      originKind: "subject",
      originId: "corpus-subject-a",
    });
    await expect(
      client.execute({
        sql: `UPDATE content_versions SET contentHash = ? WHERE id = ?`,
        args: [sha256("tampered"), source!.currentVersionId],
      }),
    ).rejects.toThrow("immutable");
    await expect(
      client.execute({
        sql: `UPDATE content_chunks SET text = 'tampered' WHERE versionId = ?`,
        args: [source!.currentVersionId],
      }),
    ).rejects.toThrow("immutable");
  });

  test("rejects cross-owner project items before any source body is reachable", async () => {
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO study_projects (id, userId, title, description, revision, contextPolicyVersion, createdAt, updatedAt) VALUES ('project-a', ?, 'A', '', 1, 1, ?, ?)`,
      args: [ownerId, now, now],
    });
    await seedSource(client, {
      id: "corpus-source-private",
      ownerId: "corpus-user-b",
    });
    await expect(
      client.execute({
        sql: `INSERT INTO study_project_items (id, projectId, kind, referenceId, position, contextMode, addedAt) VALUES ('bad-item', 'project-a', 'subject', 'corpus-subject-b', 0, 'include', ?)`,
        args: [now],
      }),
    ).rejects.toThrow("not owned");
  });

  test("rejects mismatched chunk/version references and preserves referenced history", async () => {
    const current = await store.getSource({
      ownerId,
      originKind: "subject",
      originId: "corpus-subject-a",
    });
    const chunk = await client.execute({
      sql: `SELECT id, locatorJson, contentHash FROM content_chunks WHERE versionId = ? LIMIT 1`,
      args: [current!.currentVersionId],
    });
    const reference = await store.createReference({
      ownerId,
      ownerKind: "assistant-citation",
      ownerIdWithinKind: "search-fixture",
      sourceVersionId: current!.currentVersionId!,
      chunkId: String(chunk.rows[0]!.id),
      locator: JSON.parse(String(chunk.rows[0]!.locatorJson)),
      quotedContentHash: String(chunk.rows[0]!.contentHash),
    });
    expect(reference.referenceKey).toHaveLength(64);

    await seedSource(client, {
      id: "other-source",
      originId: "other-origin",
      subjectId: null,
    });
    const otherStage = await store.stageVersion({
      ...staged("other-v1", "Other"),
      identity: { ownerId, originKind: "subject", originId: "other-origin" },
      sourceId: "other-source",
    });
    const other = await store.commitVersion({
      ownerId,
      stagingId: otherStage.stagingId,
      expectedSourceId: "other-source",
      expectedPreviousVersionId: null,
    });
    await expect(
      store.createReference({
        ownerId,
        ownerKind: "assistant-citation",
        ownerIdWithinKind: "bad-search",
        sourceVersionId: other.versionId,
        chunkId: String(chunk.rows[0]!.id),
        locator: { kind: "text", startOffset: 0, endOffset: 5 },
      }),
    ).rejects.toThrow("mismatched");

    // Publish v2 correctly, then request GC for referenced v1.
    const stage = await store.stageVersion(staged("v2", "Fonction affine"));
    const second = await store.commitVersion({
      ownerId,
      stagingId: stage.stagingId,
      expectedSourceId: sourceId,
      expectedPreviousVersionId: current!.currentVersionId,
    });
    const thirdStage = await store.stageVersion(
      staged("v3", "Fonction quadratique"),
    );
    await store.commitVersion({
      ownerId,
      stagingId: thirdStage.stagingId,
      expectedSourceId: sourceId,
      expectedPreviousVersionId: second.versionId,
    });
    await store.markVersionForGc(second.versionId);
    expect((await store.collectGarbage()).deletedVersionIds).toContain(
      second.versionId,
    );
    await store.markVersionForGc(current!.currentVersionId!);
    expect((await store.collectGarbage()).deletedVersionIds).not.toContain(
      current!.currentVersionId,
    );
  });

  test("cancellation keeps the previous version current and repair publishes a clean replacement", async () => {
    const identity = {
      ownerId,
      originKind: "subject" as const,
      originId: "corpus-subject-a",
    };
    const before = await store.getSource(identity);
    const controller = new AbortController();
    const cancellingAdapter: IndexableSourceAdapter = {
      kind: "subject",
      async describe() {
        return {
          identity,
          title: "Cancelled extraction",
          yearId: "corpus-year-a",
          subjectId: "corpus-subject-a",
          coverage: "searchable-native-text",
        };
      },
      async extract() {
        controller.abort("cancelled by the fixture");
        const text = "This candidate must never be published";
        return {
          ...(await this.describe(identity)),
          versionKey: "cancelled-v4",
          extractorId: "evaluation.cancel",
          extractorVersion: "1",
          mimeType: "text/plain",
          language: "en",
          metadata: { fixture: true },
          blocks: [
            {
              text,
              locator: { kind: "text", startOffset: 0, endOffset: text.length },
              headingPath: null,
              evidenceKind: "native-text",
            },
          ],
        };
      },
    };
    const cancelledService = new CorpusIndexService(
      client,
      store,
      new IndexableSourceRegistry([cancellingAdapter]),
    );
    await expect(
      cancelledService.indexSource(identity, { signal: controller.signal }),
    ).rejects.toThrow();
    expect((await store.getSource(identity))?.currentVersionId).toBe(
      before?.currentVersionId,
    );

    const repairService = new CorpusIndexService(
      client,
      store,
      createCoreSourceRegistry(client),
    );
    expect(await repairService.staleSources(ownerId)).toContainEqual(identity);
    const repair = await repairService.repair({ ownerId });
    expect(repair.repairedVersionIds).toHaveLength(1);
    const repaired = await store.getSource(identity);
    expect(repaired?.currentVersionId).not.toBe(before?.currentVersionId);
    expect(repaired?.status).toBe("ready");
    expect(
      (await new SqliteFts5LexicalSearchBackend(client).verify()).consistent,
    ).toBe(true);
  });
});

describe("RoutedCorpusStore sealed Node placement", () => {
  test("migrates Core → Node A → Node B → Core without a readable Core mirror", async () => {
    const routedOwnerId = "corpus-user-b";
    const routedSourceId = "corpus-source-routed";
    const routedOriginId = "routed-material-a";
    const plaintext = "La dérivée mesure le taux de variation instantané.";
    await seedSource(client, {
      id: routedSourceId,
      ownerId: routedOwnerId,
      originKind: "material",
      originId: routedOriginId,
    });

    let nodeOnline = true;
    let tamperCandidateIdentity = false;
    const remote = new Map<string, LexicalVersionInput[]>();
    const fakeTransport = {
      async online() {
        return nodeOnline;
      },
      async lexicalCapabilities() {
        return {
          available: true,
          implementation: "fixture-node-lexical",
          modes: ["terms", "exact"] as const,
        };
      },
      async upsertLexicalVersion(input: {
        nodeId: string;
        version: LexicalVersionInput;
      }) {
        const versions = remote.get(input.nodeId) ?? [];
        remote.set(input.nodeId, [
          ...versions.filter(
            (entry) => entry.version.id !== input.version.version.id,
          ),
          structuredClone(input.version),
        ]);
      },
      async exportLexicalOwner(input: { nodeId: string; ownerId: string }) {
        return structuredClone(
          (remote.get(input.nodeId) ?? []).filter(
            (entry) => entry.ownerId === input.ownerId,
          ),
        );
      },
      async getLexicalChunks(input: {
        nodeId: string;
        ownerId: string;
        chunkIds: readonly string[];
      }) {
        const chunks = (remote.get(input.nodeId) ?? [])
          .filter((entry) => entry.ownerId === input.ownerId)
          .flatMap((entry) => entry.chunks);
        return input.chunkIds.map((chunkId) => {
          const chunk = chunks.find((candidate) => candidate.chunkId === chunkId);
          if (!chunk) throw new Error("NODE_LEXICAL_CHUNK_NOT_FOUND");
          return structuredClone(chunk);
        });
      },
      async searchLexical(input: { nodeId: string; ownerId: string }) {
        const version = (remote.get(input.nodeId) ?? []).find(
          (entry) =>
            entry.ownerId === input.ownerId &&
            entry.source.id === routedSourceId,
        );
        const chunk = version?.chunks[0];
        if (!version || !chunk?.chunkId) return [];
        return [{
          sourceId: tamperCandidateIdentity
            ? "forged-source"
            : version.source.id,
          versionId: version.version.id,
          chunkId: chunk.chunkId,
          ordinal: chunk.ordinal,
          score: 1,
          snippet: "untrusted Node snippet",
          locator: chunk.locator,
          contentHash: chunk.contentHash,
          evidenceKind: chunk.evidenceKind,
        }];
      },
    } as unknown as NodeLexicalSearchTransport;
    const routed = new RoutedCorpusStore(
      client,
      fakeTransport,
      "routed-corpus-test-secret-with-at-least-32-bytes",
    );
    const stagedVersion: StagedContentVersion = {
      identity: {
        ownerId: routedOwnerId,
        originKind: "material",
        originId: routedOriginId,
      },
      sourceId: routedSourceId,
      versionKey: "routed-v1",
      contentHash: sha256(plaintext),
      extractorId: "fixture",
      extractorVersion: "1",
      mimeType: "text/plain",
      language: "fr",
      byteSize: plaintext.length,
      locatorSchemaVersion: 1,
      metadata: {},
      chunks: [{
        ordinal: 0,
        text: plaintext,
        normalizedText: normalizeForSearch(plaintext),
        tokenEstimate: 12,
        contentHash: sha256(plaintext),
        locator: { kind: "text", startOffset: 0, endOffset: plaintext.length },
        headingPath: ["Analyse"],
        evidenceKind: "native-text",
      }],
    };
    const stage = await routed.stageVersion(stagedVersion);
    const committed = await routed.commitVersion({
      ownerId: routedOwnerId,
      stagingId: stage.stagingId,
      expectedSourceId: routedSourceId,
      expectedPreviousVersionId: null,
    });

    await routed.migratePlacement({
      ownerId: routedOwnerId,
      source: { kind: "core", providerId: "core-lexical" },
      destination: {
        kind: "node",
        nodeId: "node-a",
        providerId: "node-lexical",
      },
    });
    const sealed = (
      await client.execute({
        sql: `SELECT chunks.id, chunks.text, chunks.normalizedText,
            sources.placement, sources.placementRef
          FROM content_chunks AS chunks
          JOIN content_versions AS versions ON versions.id = chunks.versionId
          JOIN content_sources AS sources ON sources.id = versions.sourceId
          WHERE versions.id = ?`,
        args: [committed.versionId],
      })
    ).rows[0]!;
    expect(String(sealed.text)).toStartWith("avermate-node-chunk:v1:");
    expect(String(sealed.text)).not.toContain(plaintext);
    expect(String(sealed.normalizedText)).not.toContain(plaintext);
    expect(sealed).toMatchObject({ placement: "node", placementRef: "node-a" });
    expect(
      (
        await client.execute({
          sql: `SELECT count(*) AS count FROM content_chunks_fts
            WHERE versionId = ?`,
          args: [committed.versionId],
        })
      ).rows[0]?.count,
    ).toBe(0);
    expect(
      remote
        .get("node-a")
        ?.find((entry) => entry.source.id === routedSourceId)
        ?.chunks[0]?.text,
    ).toBe(plaintext);

    const reader = new RoutedCorpusContentReader(client, fakeTransport);
    expect(
      (await reader.readOwnedChunk(routedOwnerId, String(sealed.id)))?.text,
    ).toBe(plaintext);
    const nodeResults = await routed.search({
      ownerId: routedOwnerId,
      query: "variation",
      mode: "terms",
      projectIds: [],
      yearIds: [],
      subjectIds: [],
      originKinds: ["material"],
      limit: 5,
      cursor: null,
    });
    expect(nodeResults).toMatchObject([
      { chunkId: String(sealed.id), snippet: plaintext },
    ]);
    tamperCandidateIdentity = true;
    await expect(
      routed.search({
        ownerId: routedOwnerId,
        query: "variation",
        mode: "terms",
        projectIds: [],
        yearIds: [],
        subjectIds: [],
        originKinds: ["material"],
        limit: 5,
        cursor: null,
      }),
    ).rejects.toThrow("NODE_RETRIEVAL_CANDIDATE_IDENTITY_MISMATCH");
    tamperCandidateIdentity = false;
    nodeOnline = false;
    await expect(
      reader.readOwnedChunk(routedOwnerId, String(sealed.id)),
    ).rejects.toThrow("NODE_RETRIEVAL_CAPABILITY_OFFLINE");
    nodeOnline = true;

    await routed.migratePlacement({
      ownerId: routedOwnerId,
      source: {
        kind: "node",
        nodeId: "node-a",
        providerId: "node-lexical",
      },
      destination: {
        kind: "node",
        nodeId: "node-b",
        providerId: "node-lexical",
      },
    });
    expect(
      remote
        .get("node-b")
        ?.find((entry) => entry.source.id === routedSourceId)
        ?.chunks[0]?.text,
    ).toBe(plaintext);
    expect(
      (
        await client.execute({
          sql: `SELECT placementRef, text FROM content_sources
            JOIN content_versions ON content_versions.sourceId = content_sources.id
            JOIN content_chunks ON content_chunks.versionId = content_versions.id
            WHERE content_sources.id = ? LIMIT 1`,
          args: [routedSourceId],
        })
      ).rows[0],
    ).toMatchObject({ placementRef: "node-b" });

    const directText = "Une primitive de 2x est x².";
    const directSource = await routed.registerSource({
      ownerId: routedOwnerId,
      originKind: "material",
      originId: "routed-material-direct-node",
      yearId: "corpus-year-b",
      subjectId: "corpus-subject-b",
      coverage: "searchable-native-text",
      placement: { kind: "node", nodeId: "node-b" },
    });
    const directStage = await routed.stageVersion({
      ...stagedVersion,
      identity: {
        ownerId: routedOwnerId,
        originKind: "material",
        originId: "routed-material-direct-node",
      },
      sourceId: directSource.id,
      versionKey: "direct-node-v1",
      contentHash: sha256(directText),
      byteSize: directText.length,
      chunks: [{
        ...stagedVersion.chunks[0]!,
        text: directText,
        normalizedText: normalizeForSearch(directText),
        contentHash: sha256(directText),
        locator: { kind: "text", startOffset: 0, endOffset: directText.length },
      }],
    });
    const directCommitted = await routed.commitVersion({
      ownerId: routedOwnerId,
      stagingId: directStage.stagingId,
      expectedSourceId: directSource.id,
      expectedPreviousVersionId: null,
    });
    expect(
      remote
        .get("node-b")
        ?.find((entry) => entry.source.id === directSource.id)
        ?.chunks[0]?.text,
    ).toBe(directText);
    expect(
      (
        await client.execute({
          sql: `SELECT text FROM content_chunks WHERE versionId = ? LIMIT 1`,
          args: [directCommitted.versionId],
        })
      ).rows[0]?.text,
    ).toStartWith("avermate-node-chunk:v1:");
    await client.execute({
      sql: `INSERT INTO corpus_payload_rewrite_leases (
          id, userId, sourceId, sourcePlacement, sourceNodeId,
          destinationPlacement, destinationNodeId, expiresAt, createdAt
        ) VALUES ('legacy-direct-node-lease', ?, ?, 'node', 'node-b',
          'node', 'node-b', 4102444800, 1)`,
      args: [routedOwnerId, directSource.id],
    });
    await client.execute({
      sql: `UPDATE content_chunks SET text = ?, normalizedText = ?,
          headingPathJson = '["Analyse"]' WHERE versionId = ?`,
      args: [
        directText,
        normalizeForSearch(directText),
        directCommitted.versionId,
      ],
    });
    await client.execute(`DELETE FROM corpus_payload_rewrite_leases
      WHERE id = 'legacy-direct-node-lease'`);
    expect(await routed.reconcileNodeEnvelopes()).toContainEqual({
      sourceId: directSource.id,
      outcome: "sealed",
    });
    expect(
      (
        await client.execute({
          sql: `SELECT text FROM content_chunks WHERE versionId = ? LIMIT 1`,
          args: [directCommitted.versionId],
        })
      ).rows[0]?.text,
    ).toStartWith("avermate-node-chunk:v1:");

    await routed.migratePlacement({
      ownerId: routedOwnerId,
      source: {
        kind: "node",
        nodeId: "node-b",
        providerId: "node-lexical",
      },
      destination: { kind: "core", providerId: "core-lexical" },
    });
    const restored = (
      await client.execute({
        sql: `SELECT sources.placement, sources.placementRef, chunks.text,
            chunks.headingPathJson
          FROM content_sources AS sources
          JOIN content_versions AS versions ON versions.sourceId = sources.id
          JOIN content_chunks AS chunks ON chunks.versionId = versions.id
          WHERE sources.id = ? LIMIT 1`,
        args: [routedSourceId],
      })
    ).rows[0]!;
    expect(restored).toMatchObject({
      placement: "core",
      placementRef: null,
      text: plaintext,
      headingPathJson: '["Analyse"]',
    });
    expect(
      (
        await client.execute({
          sql: `SELECT text FROM content_chunks WHERE versionId = ? LIMIT 1`,
          args: [directCommitted.versionId],
        })
      ).rows[0]?.text,
    ).toBe(directText);
    expect(
      await routed.search({
        ownerId: routedOwnerId,
        query: "taux de variation",
        mode: "exact",
        projectIds: [],
        yearIds: [],
        subjectIds: [],
        originKinds: ["material"],
        limit: 5,
        cursor: null,
      }),
    ).toMatchObject([{ chunkId: String(sealed.id) }]);
  }, 120_000);
});

describe("mandatory lexical retrieval, citations and deterministic hybrid primitives", () => {
  const goldChunks = new Map<string, string>();
  const evalSources = new Map<string, string>();

  test("indexes the fixed 64-query bilingual labelled corpus", async () => {
    expect(RETRIEVAL_EVALUATION_028.length).toBeGreaterThanOrEqual(60);
    const byKind = new Map<
      (typeof RETRIEVAL_EVALUATION_028)[number]["sourceKind"],
      Array<(typeof RETRIEVAL_EVALUATION_028)[number]>
    >();
    for (const fixture of RETRIEVAL_EVALUATION_028) {
      const entries = byKind.get(fixture.sourceKind) ?? [];
      entries.push(fixture);
      byKind.set(fixture.sourceKind, entries);
    }
    for (const [kind, fixtures] of byKind) {
      const id = `eval-source-${kind}`;
      const originId = `eval-origin-${kind}`;
      evalSources.set(kind, id);
      await seedSource(client, {
        id,
        originId,
        originKind: kind,
        subjectId: "corpus-subject-a",
      });
      const chunks = fixtures.map((fixture, ordinal) => ({
        ordinal,
        text: fixture.passage,
        normalizedText: normalizeForSearch(fixture.passage),
        tokenEstimate: Math.ceil(fixture.passage.length / 4),
        contentHash: sha256(fixture.passage),
        locator: fixture.locator,
        headingPath:
          fixture.locator.kind === "markdown"
            ? fixture.locator.headingPath
            : null,
        evidenceKind:
          kind === "recording"
            ? ("transcript" as const)
            : ("native-text" as const),
      }));
      if (kind === "subject") {
        chunks.push({
          ordinal: chunks.length,
          text: "Relativité restreinte : E=mc^2",
          normalizedText: normalizeForSearch("Relativité restreinte : E=mc^2"),
          tokenEstimate: 8,
          contentHash: sha256("Relativité restreinte : E=mc^2"),
          locator: { kind: "text", startOffset: 0, endOffset: 31 },
          headingPath: null,
          evidenceKind: "native-text",
        });
      }
      const stage = await store.stageVersion({
        identity: { ownerId, originKind: kind, originId },
        sourceId: id,
        versionKey: "evaluation-v1",
        contentHash: sha256(fixtures.map((entry) => entry.passage).join("\n")),
        extractorId: `evaluation.${kind}`,
        extractorVersion: "1",
        mimeType: "text/plain",
        language: null,
        byteSize: fixtures.reduce(
          (total, entry) => total + entry.passage.length,
          0,
        ),
        locatorSchemaVersion: 1,
        metadata: { fixture: "028", kind },
        chunks,
      });
      const committed = await store.commitVersion({
        ownerId,
        stagingId: stage.stagingId,
        expectedSourceId: id,
        expectedPreviousVersionId: null,
      });
      const storedChunks = await client.execute({
        sql: `SELECT id, ordinal FROM content_chunks WHERE versionId = ? ORDER BY ordinal`,
        args: [committed.versionId],
      });
      fixtures.forEach((fixture, index) => {
        goldChunks.set(fixture.id, String(storedChunks.rows[index]!.id));
      });
    }
    expect(goldChunks.size).toBe(RETRIEVAL_EVALUATION_028.length);
  });

  test("meets Recall@5, MRR and returned Precision@5 thresholds without providers", async () => {
    const backend = new SqliteFts5LexicalSearchBackend(client);
    expect((await backend.capabilities()).available).toBe(true);
    let recalled = 0;
    let reciprocalRanks = 0;
    let precisions = 0;
    for (const fixture of RETRIEVAL_EVALUATION_028) {
      const results = await backend.search({
        ownerId,
        query: fixture.query,
        mode: "terms",
        projectIds: [],
        yearIds: [],
        subjectIds: [],
        originKinds: [],
        limit: 5,
        cursor: null,
      });
      const rank = results.findIndex(
        (candidate) => candidate.chunkId === goldChunks.get(fixture.id),
      );
      if (rank >= 0) {
        recalled += 1;
        reciprocalRanks += 1 / (rank + 1);
      }
      const relevant = results.filter(
        (candidate) => candidate.chunkId === goldChunks.get(fixture.id),
      ).length;
      precisions += results.length === 0 ? 0 : relevant / results.length;
    }
    const count = RETRIEVAL_EVALUATION_028.length;
    expect(recalled / count).toBeGreaterThanOrEqual(0.85);
    expect(reciprocalRanks / count).toBeGreaterThanOrEqual(0.75);
    expect(precisions / count).toBeGreaterThanOrEqual(0.7);
  });

  test("supports accents, phrase, prefix, exact formulas and inert syntax", async () => {
    const backend = new SqliteFts5LexicalSearchBackend(client);
    const query = (
      value: string,
      mode: "terms" | "phrase" | "prefix" | "exact",
    ) =>
      backend.search({
        ownerId,
        query: value,
        mode,
        projectIds: [],
        yearIds: [],
        subjectIds: [],
        originKinds: [],
        limit: 10,
        cursor: null,
      });
    expect(
      (await query("theoreme", "terms")).some((entry) =>
        entry.snippet.includes("théorème"),
      ),
    ).toBe(true);
    expect((await query("opportunity cost", "phrase"))[0]?.snippet).toContain(
      "Opportunity cost",
    );
    expect((await query("mitochon", "prefix"))[0]?.snippet).toContain(
      "mitochondrie",
    );
    expect((await query("E=mc^2", "exact"))[0]?.snippet).toContain("E=mc^2");
    await expect(query('" OR * NOT', "terms")).resolves.toEqual([]);
  });

  test("filters owner and project scope before selecting bodies", async () => {
    await seedSource(client, {
      id: "eval-private-b",
      ownerId: "corpus-user-b",
      originId: "private-eval-b",
      originKind: "material",
      subjectId: "corpus-subject-b",
    });
    const privateStage = await store.stageVersion({
      ...staged("private-v1", "mitochondrie donnée confidentielle"),
      identity: {
        ownerId: "corpus-user-b",
        originKind: "material",
        originId: "private-eval-b",
      },
      sourceId: "eval-private-b",
    });
    await store.commitVersion({
      ownerId: "corpus-user-b",
      stagingId: privateStage.stagingId,
      expectedSourceId: "eval-private-b",
      expectedPreviousVersionId: null,
    });
    const now = Math.floor(Date.now() / 1_000);
    await client.batch(
      [
        {
          sql: `INSERT INTO study_projects (id, userId, title, description, yearId, revision, contextPolicyVersion, createdAt, updatedAt) VALUES ('eval-project', ?, 'Biologie', '', 'corpus-year-a', 1, 1, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO study_project_items (id, projectId, kind, referenceId, position, contextMode, addedAt) VALUES ('eval-project-item', 'eval-project', 'material', 'eval-origin-material', 0, 'include', ?)`,
          args: [now],
        },
      ],
      "write",
    );
    const backend = new SqliteFts5LexicalSearchBackend(client);
    const results = await backend.search({
      ownerId,
      query: "mitochondrie",
      mode: "terms",
      projectIds: ["eval-project"],
      yearIds: [],
      subjectIds: [],
      originKinds: [],
      limit: 10,
      cursor: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.sourceId).toBe(evalSources.get("material")!);
    expect(results.some((entry) => entry.sourceId === "eval-private-b")).toBe(
      false,
    );
  });

  test("paginates deterministically and rebuild equals incremental state", async () => {
    const backend = new SqliteFts5LexicalSearchBackend(client);
    const base = {
      ownerId,
      query: "une",
      mode: "terms" as const,
      projectIds: [],
      yearIds: [],
      subjectIds: [],
      originKinds: [],
      limit: 3,
    };
    const first = await backend.search({ ...base, cursor: null });
    const second = await backend.search({ ...base, cursor: lexicalCursor(3) });
    expect(first).toHaveLength(3);
    expect(second.length).toBeGreaterThan(0);
    expect(
      second.some((entry) =>
        first.some((one) => one.chunkId === entry.chunkId),
      ),
    ).toBe(false);
    const before = await backend.search({
      ...base,
      query: "mitochondrie",
      limit: 10,
      cursor: null,
    });
    const report = await backend.rebuild();
    const after = await backend.search({
      ...base,
      query: "mitochondrie",
      limit: 10,
      cursor: null,
    });
    expect(report.consistent).toBe(true);
    expect(after.map((entry) => entry.chunkId)).toEqual(
      before.map((entry) => entry.chunkId),
    );
  });

  test("never keeps or searches a Node-owned source in Core FTS", async () => {
    const nodeSourceId = `node-source-${crypto.randomUUID()}`;
    const nodeOriginId = `node-origin-${crypto.randomUUID()}`;
    const text = "NODE_ONLY_LEXICAL_SECRET zygomatique";
    await seedSource(client, {
      id: nodeSourceId,
      originId: nodeOriginId,
      originKind: "material",
    });
    const input = {
      ...staged(`node-v-${crypto.randomUUID()}`, text),
      identity: {
        ownerId,
        originKind: "material" as const,
        originId: nodeOriginId,
      },
      sourceId: nodeSourceId,
    };
    const stage = await store.stageVersion(input);
    const committed = await store.commitVersion({
      ownerId,
      stagingId: stage.stagingId,
      expectedSourceId: nodeSourceId,
      expectedPreviousVersionId: null,
    });
    await client.execute({
      sql: `UPDATE content_sources SET placement = 'node', placementRef = 'node-private'
        WHERE id = ? AND userId = ?`,
      args: [nodeSourceId, ownerId],
    });

    const backend = new SqliteFts5LexicalSearchBackend(client);
    const source = await store.getSource(input.identity);
    const version = await store.resolveVersion({
      ownerId,
      sourceId: nodeSourceId,
      versionId: committed.versionId,
    });
    await backend.upsertVersion({
      ownerId,
      source: source!,
      version,
      chunks: input.chunks,
    });
    expect(
      (
        await client.execute({
          sql: `SELECT chunkId FROM content_chunks_fts WHERE versionId = ?`,
          args: [committed.versionId],
        })
      ).rows,
    ).toHaveLength(0);

    // Simulate a stale/pre-migration row and prove both search paths fence it.
    await client.execute({
      sql: `INSERT INTO content_chunks_fts
        (chunkId, versionId, sourceId, ownerId, text, normalizedText)
        SELECT chunks.id, versions.id, sources.id, sources.userId,
          chunks.text, chunks.normalizedText
        FROM content_chunks AS chunks
        JOIN content_versions AS versions ON versions.id = chunks.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE versions.id = ?`,
      args: [committed.versionId],
    });
    const query = (mode: "terms" | "exact") =>
      backend.search({
        ownerId,
        query: mode === "exact" ? "NODE_ONLY_LEXICAL_SECRET" : "zygomatique",
        mode,
        projectIds: [],
        yearIds: [],
        subjectIds: [],
        originKinds: [],
        limit: 10,
        cursor: null,
      });
    expect(await query("terms")).toEqual([]);
    expect(await query("exact")).toEqual([]);

    const inconsistent = await backend.verify();
    expect(inconsistent.orphanedVersionIds).toContain(committed.versionId);
    expect(inconsistent.missingVersionIds).not.toContain(committed.versionId);
    expect((await backend.rebuild()).consistent).toBe(true);
    expect(
      (
        await client.execute({
          sql: `SELECT chunkId FROM content_chunks_fts WHERE versionId = ?`,
          args: [committed.versionId],
        })
      ).rows,
    ).toHaveLength(0);
  });

  test("resolves an exact durable locator and immutable content hash", async () => {
    const backend = new SqliteFts5LexicalSearchBackend(client);
    const [candidate] = await backend.search({
      ownerId,
      query: "mitochondrie",
      mode: "terms",
      projectIds: [],
      yearIds: [],
      subjectIds: [],
      originKinds: [],
      limit: 1,
      cursor: null,
    });
    const reference = await store.createReference({
      ownerId,
      ownerKind: "assistant-citation",
      ownerIdWithinKind: "eval-search-citation",
      sourceVersionId: candidate!.versionId,
      chunkId: candidate!.chunkId,
      locator: candidate!.locator,
      quotedContentHash: candidate!.contentHash,
    });
    const resolver = new CoreCitationResolver(client);
    const resolved = await resolver.resolve({
      ownerId,
      referenceId: reference.id,
    });
    expect(resolved.locator).toEqual(candidate!.locator);
    expect(resolved.contentHash).toBe(candidate!.contentHash);
    expect(await resolver.open({ ownerId, referenceId: reference.id })).toEqual(
      resolved.openTarget,
    );
    await expect(
      resolver.resolve({ ownerId: "corpus-user-b", referenceId: reference.id }),
    ).rejects.toThrow("not found");
  });

  test("keeps vector ownership and RRF ordering deterministic", async () => {
    const vector = new InMemoryVectorIndex([3]);
    await vector.upsert([
      {
        ownerId,
        spaceId: "space-v1",
        sourceId: "source-a",
        versionId: "version-a",
        chunkId: "chunk-a",
        values: [1, 0, 0],
      },
      {
        ownerId: "corpus-user-b",
        spaceId: "space-v1",
        sourceId: "source-private",
        versionId: "version-private",
        chunkId: "chunk-private",
        values: [1, 0, 0],
      },
      {
        ownerId,
        spaceId: "space-v1",
        sourceId: "source-b",
        versionId: "version-b",
        chunkId: "chunk-b",
        values: [0.8, 0.2, 0],
      },
    ]);
    const found = await vector.search({
      ownerId,
      spaceId: "space-v1",
      values: [1, 0, 0],
      limit: 5,
    });
    expect(found.map((entry) => entry.chunkId)).toEqual(["chunk-a", "chunk-b"]);
    const fused = reciprocalRankFusion({
      lexical: [found[1]!, found[0]!],
      vector: found,
    });
    expect(fused.map((entry) => entry.chunkId)).toEqual(["chunk-a", "chunk-b"]);
    expect(fused[0]?.channels).toEqual(["lexical", "vector"]);
  });
});

describe("native adapter locator and truthful coverage conformance", () => {
  test("preserves material, Markdown, transcript, grade and subject locators", async () => {
    const now = Math.floor(Date.now() / 1_000);
    await client.batch(
      [
        {
          sql: `INSERT INTO files (id, provider, storageKey, url, mimeType, byteSize, purpose, status, previewStatus, userId, createdAt, updatedAt) VALUES ('adapter-pdf-file', 'local', 'adapter/pdf', 'private://adapter/pdf', 'application/pdf', 42, 'course-material', 'stored', 'unsupported', ?, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO files (id, provider, storageKey, url, mimeType, byteSize, purpose, status, previewStatus, userId, createdAt, updatedAt) VALUES ('adapter-video-file', 'local', 'adapter/video', 'private://adapter/video', 'video/mp4', 42, 'course-media', 'stored', 'unsupported', ?, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO material_documents (id, title, sourceType, textContent, origin, yearId, userId, createdAt, updatedAt) VALUES ('adapter-inline', 'Texte libre', 'text', 'Définition exacte du gradient.', 'manual', 'corpus-year-a', ?, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO material_documents (id, title, sourceType, fileId, origin, yearId, userId, createdAt, updatedAt) VALUES ('adapter-ocr', 'Copie OCR', 'file', 'adapter-pdf-file', 'manual', 'corpus-year-a', ?, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO material_documents (id, title, sourceType, sourceUrl, origin, yearId, userId, createdAt, updatedAt) VALUES ('adapter-web', 'Page Web', 'link', 'https://example.test/course', 'manual', 'corpus-year-a', ?, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO material_documents (id, title, sourceType, fileId, origin, yearId, userId, createdAt, updatedAt) VALUES ('adapter-media', 'Cours filmé', 'file', 'adapter-video-file', 'manual', 'corpus-year-a', ?, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO material_documents (id, title, sourceType, fileId, origin, yearId, userId, createdAt, updatedAt) VALUES ('adapter-scan', 'Scan historique', 'file', 'adapter-pdf-file', 'manual', 'corpus-year-a', ?, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO material_artifacts (id, documentId, kind, status, content, metaVersion, metaJson, userId, createdAt, updatedAt) VALUES ('adapter-ocr-artifact', 'adapter-ocr', 'ocr-markdown', 'ready', 'page exacte', 1, ?, ?, ?, ?)`,
          args: [
            JSON.stringify({
              pageCount: 1,
              model: "fixture",
              providerFileId: "opaque",
              durationMs: 1,
            }),
            ownerId,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO material_artifact_segments (id, artifactId, ordinal, text, locatorJson, contentHash) VALUES ('adapter-ocr-segment', 'adapter-ocr-artifact', 0, 'page exacte', ?, ?)`,
          args: [
            JSON.stringify({ kind: "pdf", page: 3 }),
            sha256("page exacte"),
          ],
        },
        {
          sql: `INSERT INTO material_artifacts (id, documentId, kind, status, content, metaVersion, metaJson, userId, createdAt, updatedAt) VALUES ('adapter-web-artifact', 'adapter-web', 'web-markdown', 'ready', '# Cinétique\n\nVitesse de réaction.', 1, ?, ?, ?, ?)`,
          args: [
            JSON.stringify({
              kind: "web",
              finalUrl: "https://example.test/course",
              fetchedAt: new Date(now * 1000).toISOString(),
              title: "Page Web",
            }),
            ownerId,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO material_artifacts (id, documentId, kind, status, content, metaVersion, metaJson, userId, createdAt, updatedAt) VALUES ('adapter-media-artifact', 'adapter-media', 'media-transcript', 'ready', 'segment exact', 1, ?, ?, ?, ?)`,
          args: [
            JSON.stringify({
              provider: "fixture",
              segmentCount: 1,
              durationMs: 9000,
            }),
            ownerId,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO material_artifact_segments (id, artifactId, ordinal, text, locatorJson, contentHash) VALUES ('adapter-media-segment', 'adapter-media-artifact', 0, 'segment exact', ?, ?)`,
          args: [
            JSON.stringify({ kind: "video", startMs: 1200, endMs: 4500 }),
            sha256("segment exact"),
          ],
        },
        {
          sql: `INSERT INTO material_artifacts (id, documentId, kind, status, content, metaVersion, metaJson, userId, createdAt, updatedAt) VALUES ('adapter-scan-artifact', 'adapter-scan', 'ocr-markdown', 'ready', 'flattened legacy body must not be indexed', 1, ?, ?, ?, ?)`,
          args: [
            JSON.stringify({
              pageCount: 2,
              model: "legacy",
              providerFileId: "opaque",
              durationMs: 1,
            }),
            ownerId,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO study_documents (id, kind, title, bodyMarkdown, revision, metaVersion, yearId, subjectId, userId, createdAt, updatedAt) VALUES ('adapter-study', 'fiche', 'Fiche chimie', '# Acides\n\nLe pH mesure acidité.', 4, 1, 'corpus-year-a', 'corpus-subject-a', ?, ?, ?)`,
          args: [ownerId, now, now],
        },
        {
          sql: `INSERT INTO lecture_recordings (id, title, status, recordedAt, durationMs, subjectId, yearId, userId, createdAt, updatedAt) VALUES ('adapter-recording', 'Cours oral', 'ready', ?, 10000, 'corpus-subject-a', 'corpus-year-a', ?, ?, ?)`,
          args: [now, ownerId, now, now],
        },
        {
          sql: `INSERT INTO recording_transcripts (recordingId, text, segmentsVersion, segmentsJson, language, provider, userId, createdAt, updatedAt) VALUES ('adapter-recording', 'loi exacte', 1, ?, 'fr', 'fixture', ?, ?, ?)`,
          args: [
            JSON.stringify([
              { startMs: 2100, endMs: 6300, text: "loi exacte" },
            ]),
            ownerId,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO grades (id, name, value, outOf, coefficient, bonus, isComposite, excludedFromAverage, syncExcludedFromAverage, passedAt, subjectId, yearId, userId, createdAt, updatedAt) VALUES ('adapter-grade', 'DS énergie', 15, 20, 2, 0, 0, 0, 0, ?, 'corpus-subject-a', 'corpus-year-a', ?, ?, ?)`,
          args: [now, ownerId, now, now],
        },
      ],
      "write",
    );

    const registry = createCoreSourceRegistry(client);
    const owned = (
      originKind: Parameters<typeof registry.extract>[0]["originKind"],
      originId: string,
    ) => registry.extract({ ownerId, originKind, originId });
    const inline = await owned("material", "adapter-inline");
    expect(inline.blocks[0]?.locator).toEqual({
      kind: "text",
      startOffset: 0,
      endOffset: "Définition exacte du gradient.".length,
    });
    const ocr = await owned("material", "adapter-ocr");
    expect(ocr.coverage).toBe("searchable-ocr");
    expect(ocr.blocks[0]?.locator).toEqual({ kind: "pdf", page: 3 });
    expect(
      ocr.blocks.some(
        (block) =>
          block.evidenceKind === "visual-only" &&
          block.locator.kind === "pdf" &&
          block.locator.page === 3,
      ),
    ).toBe(true);
    const web = await owned("material", "adapter-web");
    expect(web.blocks[0]?.locator).toEqual({
      kind: "markdown",
      headingPath: ["Cinétique"],
      startLine: 1,
      endLine: 1,
    });
    const media = await owned("material", "adapter-media");
    expect(media.blocks[0]?.locator).toEqual({
      kind: "video",
      startMs: 1200,
      endMs: 4500,
    });
    expect(media.blocks[0]?.evidenceKind).toBe("transcript");
    expect(media.blocks[1]).toMatchObject({
      evidenceKind: "visual-only",
      locator: { kind: "video", startMs: 1200, endMs: 4500 },
    });
    const legacyScan = await owned("material", "adapter-scan");
    expect(legacyScan.coverage).toBe("metadata-and-locators-only");
    expect(
      legacyScan.blocks.every((block) => block.evidenceKind === "visual-only"),
    ).toBe(true);
    expect(
      legacyScan.blocks.some((block) =>
        block.text.includes("flattened legacy"),
      ),
    ).toBe(false);
    const study = await owned("study-document", "adapter-study");
    expect(study.blocks[0]?.locator).toMatchObject({
      kind: "markdown",
      headingPath: ["Acides"],
    });
    const recording = await owned("recording", "adapter-recording");
    expect(recording.blocks[0]?.locator).toEqual({
      kind: "audio",
      startMs: 2100,
      endMs: 6300,
    });
    const grade = await owned("grade", "adapter-grade");
    expect(grade.blocks[0]?.locator).toEqual({
      kind: "grade",
      gradeId: "adapter-grade",
    });
    const subject = await owned("subject", "corpus-subject-a");
    expect(subject.blocks[0]?.text).toContain("Mathématiques");
    await expect(
      registry.extract({
        ownerId,
        originKind: "conversation",
        originId: "disabled",
      }),
    ).rejects.toThrow("Conversation was not found or is not owned");
  });
});
