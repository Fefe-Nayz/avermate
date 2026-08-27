import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilesystemLexicalSearchBackend } from "./lexical-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const digest = "a".repeat(64);
const now = new Date().toISOString();

describe("FilesystemLexicalSearchBackend", () => {
  test("persists bounded owner-filtered phrase and term search", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-lexical-"));
    roots.push(root);
    const path = join(root, "lexical.json");
    const backend = new FilesystemLexicalSearchBackend({
      path,
      ownerId: "owner-1",
      maximumBytes: 10 * 1024 * 1024,
    });
    await backend.upsertVersion({
      ownerId: "owner-1",
      source: {
        id: "source-1",
        ownerId: "owner-1",
        originKind: "material",
        originId: "material-1",
        yearId: "year-1",
        subjectId: "subject-1",
        currentVersionId: "version-1",
        status: "ready",
        coverage: "searchable-native-text",
        placement: { kind: "node", nodeId: "node-1" },
        placementRef: null,
        createdAt: now,
        updatedAt: now,
      },
      version: {
        id: "version-1",
        sourceId: "source-1",
        versionKey: "v1",
        contentHash: digest,
        extractorId: "extractor-1",
        extractorVersion: "1",
        mimeType: "text/plain",
        language: "fr",
        byteSize: 64,
        locatorSchemaVersion: 1,
        metadata: { projectIds: ["project-1"] },
        createdAt: now,
      },
      chunks: [
        {
          chunkId: "chunk-committed-1",
          ordinal: 0,
          text: "La photosynthèse transforme la lumière.",
          normalizedText: "la photosynthese transforme la lumiere",
          tokenEstimate: 6,
          contentHash: digest,
          locator: { kind: "text", startOffset: 0, endOffset: 43 },
          headingPath: null,
          evidenceKind: "native-text",
        },
      ],
    });
    await backend.upsertVersion({
      ownerId: "owner-1",
      source: {
        id: "source-2",
        ownerId: "owner-1",
        originKind: "study-document",
        originId: "document-2",
        yearId: "year-1",
        subjectId: "subject-1",
        currentVersionId: "version-2",
        status: "ready",
        coverage: "searchable-native-text",
        placement: { kind: "node", nodeId: "node-1" },
        placementRef: null,
        createdAt: now,
        updatedAt: now,
      },
      version: {
        id: "version-2",
        sourceId: "source-2",
        versionKey: "v1",
        contentHash: digest,
        extractorId: "extractor-1",
        extractorVersion: "1",
        mimeType: "text/plain",
        language: "fr",
        byteSize: 64,
        locatorSchemaVersion: 1,
        metadata: { projectIds: ["project-2"] },
        createdAt: now,
      },
      chunks: [
        {
          chunkId: "chunk-committed-2",
          ordinal: 0,
          text: "La photosynthèse transforme aussi le carbone.",
          normalizedText: "la photosynthese transforme aussi le carbone",
          tokenEstimate: 7,
          contentHash: digest,
          locator: { kind: "text", startOffset: 0, endOffset: 47 },
          headingPath: null,
          evidenceKind: "native-text",
        },
      ],
    });
    const restarted = new FilesystemLexicalSearchBackend({
      path,
      ownerId: "owner-1",
      maximumBytes: 10 * 1024 * 1024,
    });
    const results = await restarted.search({
      ownerId: "owner-1",
      query: "photosynthese lumiere",
      mode: "terms",
      projectIds: ["project-1"],
      yearIds: ["year-1"],
      subjectIds: [],
      originKinds: ["material"],
      limit: 10,
      cursor: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe("chunk-committed-1");
    const scopeBase = {
      ownerId: "owner-1",
      query: "photosynthese transforme",
      mode: "terms" as const,
      projectIds: ["project-1"],
      yearIds: ["year-1"],
      subjectIds: [] as string[],
      originKinds: [] as [],
      limit: 10,
      cursor: null,
    };
    expect(
      (
        await restarted.search({
          ...scopeBase,
          sourceIds: ["source-2"],
          contextAccess: "automatic",
        })
      ).map((candidate) => candidate.sourceId),
    ).toEqual(["source-1", "source-2"]);
    expect(
      (
        await restarted.search({
          ...scopeBase,
          sourceIds: ["source-2"],
          contextAccess: "explicit-attachment",
        })
      ).map((candidate) => candidate.sourceId),
    ).toEqual(["source-2"]);
    expect(
      await restarted.search({
        ...scopeBase,
        sourceIds: [],
        versionIds: ["version-2"],
        contextAccess: "explicit-attachment",
      }),
    ).toEqual([]);
    expect(
      (
        await restarted.search({
          ...scopeBase,
          projectIds: [],
          versionIds: ["version-2"],
        })
      ).map((candidate) => candidate.versionId),
    ).toEqual(["version-2"]);
    expect((await restarted.verify()).consistent).toBe(true);
    expect(await restarted.exportOwner("owner-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerId: "owner-1",
          version: expect.objectContaining({ id: "version-1" }),
          chunks: [expect.objectContaining({ chunkId: "chunk-committed-1" })],
        }),
      ]),
    );
    expect(
      await restarted.getChunks("owner-1", ["chunk-committed-1"]),
    ).toMatchObject([
      {
        chunkId: "chunk-committed-1",
        text: "La photosynthèse transforme la lumière.",
      },
    ]);
    await expect(
      restarted.getChunks("owner-1", ["missing-chunk"]),
    ).rejects.toThrow("NODE_LEXICAL_CHUNK_NOT_FOUND");
    await expect(
      restarted.getChunks("owner-2", ["chunk-committed-1"]),
    ).rejects.toThrow("NODE_LEXICAL_OWNER_MISMATCH");
    await expect(restarted.getChunks("owner-1", [])).rejects.toThrow(
      "NODE_LEXICAL_CHUNK_REQUEST_INVALID",
    );
    await expect(
      restarted.search({
        ownerId: "owner-2",
        query: "photosynthese",
        mode: "terms",
        projectIds: [],
        yearIds: [],
        subjectIds: [],
        originKinds: [],
        limit: 10,
        cursor: null,
      }),
    ).rejects.toThrow("NODE_LEXICAL_OWNER_MISMATCH");
    expect(await restarted.deleteOwner("owner-1")).toEqual({
      deletedVersions: 2,
    });
    expect(await restarted.exportOwner("owner-1")).toEqual([]);
  });
});
