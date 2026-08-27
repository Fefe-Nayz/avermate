import { describe, expect, test } from "bun:test";
import type {
  LexicalCandidate,
  RerankProvider,
} from "@avermate/agent-contracts";
import type { SqliteFts5LexicalSearchBackend } from "./lexical";
import type { CorpusVectorRuntime } from "./vector-runtime";
import { hybridCorpusSearch } from "./hybrid";

const embeddingSpaceId = "embedding-space-fixture";
const rerankSpaceId = "rerank-space-fixture";
const texts = new Map([
  ["chunk-lexical", "La photosynthèse transforme l'énergie lumineuse."],
  ["chunk-dense", "Les chloroplastes produisent de la matière organique."],
  ["chunk-neighbor", "Cette réaction libère également du dioxygène."],
]);

function locator(text: string) {
  return { kind: "text" as const, startOffset: 0, endOffset: text.length };
}

function candidate(
  chunkId: string,
  sourceId: string,
  versionId: string,
  ordinal: number,
  score: number,
): LexicalCandidate {
  const text = texts.get(chunkId)!;
  return {
    sourceId,
    versionId,
    chunkId,
    ordinal,
    score,
    snippet: text,
    locator: locator(text),
    contentHash: ordinal.toString(16).padStart(64, "a").slice(-64),
    evidenceKind: "native-text",
  };
}

const lexicalCandidates = [
  candidate("chunk-lexical", "source-a", "version-a", 0, 10),
  candidate("chunk-neighbor", "source-a", "version-a", 1, 5),
];
const allCandidates = [
  ...lexicalCandidates,
  candidate("chunk-dense", "source-b", "version-b", 0, 9),
];

function fakeClient(
  fallbackPolicy: "fail" | "lexical-only" | "hybrid-without-rerank",
  options: {
    activeGenerationId?: string;
    generationMemberships?: readonly {
      generationId: string;
      versionId: string;
      state?: "active" | "superseded";
      activatedAt?: number;
      updatedAt?: number;
    }[];
    unsupportedEmbeddingPlacement?: boolean;
    candidates?: readonly LexicalCandidate[];
    texts?: ReadonlyMap<string, string>;
    projects?: readonly {
      id: string;
      retrievalMode: "advanced-auto" | "lexical-only";
      retrievalFallbackPolicy:
        "fail" | "lexical-only" | "hybrid-without-rerank";
      embeddingSpaceId: string | null;
      rerankSpaceId: string | null;
    }[];
  } = {},
) {
  const fixtureCandidates = options.candidates ?? allCandidates;
  const fixtureTexts = options.texts ?? texts;
  return {
    async execute(input: string | { sql: string }) {
      const sql = typeof input === "string" ? input : input.sql;
      if (
        sql.includes("FROM content_sources AS sources") &&
        sql.includes("sources.placement != 'core'")
      ) {
        return {
          rows: options.unsupportedEmbeddingPlacement ? [{ found: 1 }] : [],
        };
      }
      if (
        sql.includes("FROM corpus_embedding_generations") &&
        sql.includes("corpus_embedding_generation_versions")
      ) {
        const memberships =
          options.generationMemberships ??
          (options.activeGenerationId
            ? [
                ...new Set(
                  fixtureCandidates.map((candidate) => candidate.versionId),
                ),
              ].map((versionId) => ({
                generationId: options.activeGenerationId!,
                versionId,
                state: "active" as const,
                activatedAt: 100,
                updatedAt: 100,
              }))
            : []);
        return {
          rows: memberships.map((membership) => ({
            generationId: membership.generationId,
            versionId: membership.versionId,
            state: membership.state ?? "active",
            activatedAt: membership.activatedAt ?? 100,
            updatedAt: membership.updatedAt ?? 100,
          })),
        };
      }
      if (sql.includes("FROM corpus_embedding_generations")) {
        return {
          rows: options.activeGenerationId
            ? [{ id: options.activeGenerationId }]
            : [],
        };
      }
      if (sql.includes("FROM study_projects")) {
        return {
          rows: options.projects ?? [
            {
              id: "project-a",
              retrievalMode: "advanced-auto",
              retrievalFallbackPolicy: fallbackPolicy,
              embeddingSpaceId,
              rerankSpaceId,
            },
          ],
        };
      }
      if (
        sql.includes("SELECT chunks.id AS chunkId") &&
        !sql.includes("chunks.text")
      ) {
        return {
          rows: fixtureCandidates.map((entry) => ({
            chunkId: entry.chunkId,
            versionId: entry.versionId,
            ordinal: entry.ordinal,
            contentHash: entry.contentHash,
            locatorJson: JSON.stringify(entry.locator),
            evidenceKind: entry.evidenceKind,
            sourceId: entry.sourceId,
          })),
        };
      }
      if (sql.includes("SELECT chunks.id, chunks.text")) {
        return {
          rows: fixtureCandidates.map((entry) => ({
            id: entry.chunkId,
            text: fixtureTexts.get(entry.chunkId),
            tokenEstimate: 12,
            headingPathJson: JSON.stringify(["SVT", "Photosynthèse"]),
          })),
        };
      }
      if (
        sql.includes("SELECT chunks.id AS chunkId") &&
        sql.includes("chunks.text")
      ) {
        const selectedCandidates = sql.includes("sourceRank <= 2")
          ? fixtureCandidates.filter(
              (candidate) =>
                fixtureCandidates
                  .filter((entry) => entry.sourceId === candidate.sourceId)
                  .sort(
                    (left, right) =>
                      left.ordinal - right.ordinal ||
                      left.chunkId.localeCompare(right.chunkId, "en"),
                  )
                  .findIndex((entry) => entry.chunkId === candidate.chunkId) <
                2,
            )
          : fixtureCandidates;
        return {
          rows: selectedCandidates.map((entry) => ({
            chunkId: entry.chunkId,
            versionId: entry.versionId,
            ordinal: entry.ordinal,
            text: fixtureTexts.get(entry.chunkId),
            tokenEstimate: 12,
            contentHash: entry.contentHash,
            locatorJson: JSON.stringify(entry.locator),
            headingPathJson: JSON.stringify(["SVT", "Photosynthèse"]),
            evidenceKind: entry.evidenceKind,
            sourceId: entry.sourceId,
          })),
        };
      }
      throw new Error(`Unexpected hybrid-search query: ${sql}`);
    },
    async transaction() {
      throw new Error("Hybrid retrieval must not mutate through a transaction");
    },
  };
}

const lexical = {
  search: async () => lexicalCandidates,
} as unknown as SqliteFts5LexicalSearchBackend;

const runtime = {
  embedding: {
    descriptor: () => ({
      id: embeddingSpaceId,
      provider: "fixture",
      model: "fixture-embedding",
      modelRevision: "fixture-embedding@1",
      dimensions: 3,
      modalities: ["text" as const],
      normalization: "provider-unit" as const,
      preprocessingRevision: "fixture-v1",
      placement: "node" as const,
    }),
    embedText: async (input: readonly { contentHash: string }[]) =>
      input.map((entry) => ({
        contentHash: entry.contentHash,
        values: [1, 0, 0],
      })),
  },
  vector: {
    forGeneration: () => ({
      capabilities: async () => ({
        available: true,
        implementation: "fixture-vector-index",
        dimensions: [3],
      }),
      search: async () => [
        {
          sourceId: "source-b",
          versionId: "version-b",
          chunkId: "chunk-dense",
          score: 0.98,
        },
        {
          sourceId: "source-a",
          versionId: "version-a",
          chunkId: "chunk-lexical",
          score: 0.72,
        },
      ],
    }),
    capabilities: async () => ({
      available: true,
      implementation: "fixture-active-alias-b",
      dimensions: [3],
    }),
    search: async () => [
      {
        sourceId: "source-b",
        versionId: "version-b",
        chunkId: "chunk-dense",
        score: 0.98,
      },
      {
        sourceId: "source-a",
        versionId: "version-a",
        chunkId: "chunk-lexical",
        score: 0.72,
      },
    ],
  },
} as unknown as CorpusVectorRuntime;

function reranker(options: { fail?: boolean } = {}): RerankProvider {
  return {
    descriptor: () => ({
      id: rerankSpaceId,
      provider: "fixture",
      model: "fixture-reranker",
      modelRevision: "fixture-reranker@1",
      languages: ["fr"],
      modalities: ["text"],
      maximumCandidates: 50,
      maximumTokensPerCandidate: 8_192,
      scoreSemantics: "sigmoid-relevance",
      placement: "node",
      costUnit: "compute-token",
    }),
    rerank: async ({ operationId, candidates, topN }) => {
      if (options.fail) throw new Error("fixture-reranker-offline");
      const order = ["chunk-dense", "chunk-lexical", "chunk-neighbor"];
      return candidates
        .filter((entry) => order.includes(entry.id))
        .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
        .slice(0, topN)
        .map((entry, rank) => ({
          operationId,
          candidateId: entry.id,
          rank,
          score: 1 - rank / 10,
        }));
    },
  };
}

function query(
  fallbackPolicy: "fail" | "lexical-only" | "hybrid-without-rerank",
) {
  return {
    ownerId: "owner-a",
    query: "Comment fonctionne la photosynthèse ?",
    mode: "terms" as const,
    projectIds: ["project-a"],
    yearIds: [],
    subjectIds: [],
    originKinds: [],
    limit: 2,
    cursor: null,
    fallbackPolicy,
    operationId: `operation-${fallbackPolicy}`,
  };
}

describe("advanced hybrid retrieval pipeline", () => {
  test("pins dense reads to the persisted generation instead of the mutable active alias", async () => {
    const selectedGenerations: Array<{
      ownerId: string;
      generationId: string;
    }> = [];
    let baseAliasRead = false;
    const generationPinnedRuntime = {
      ...runtime,
      vector: {
        capabilities: async () => {
          baseAliasRead = true;
          return {
            available: true,
            implementation: "fixture-active-alias-b",
            dimensions: [3],
          };
        },
        search: async () => {
          baseAliasRead = true;
          return [
            {
              sourceId: "source-a",
              versionId: "version-a",
              chunkId: "chunk-neighbor",
              score: 1,
            },
          ];
        },
        forGeneration: (ownerId: string, generationId: string) => {
          selectedGenerations.push({ ownerId, generationId });
          return {
            capabilities: async () => ({
              available: true,
              implementation: "fixture-generation-a",
              dimensions: [3],
            }),
            search: async () => [
              {
                sourceId: "source-b",
                versionId: "version-b",
                chunkId: "chunk-dense",
                score: 0.99,
              },
            ],
          };
        },
      },
    } as unknown as CorpusVectorRuntime;

    const result = await hybridCorpusSearch(query("fail"), {
      client: fakeClient("fail", {
        activeGenerationId: "generation-a",
      }) as never,
      lexical,
      runtime: generationPinnedRuntime,
      reranker: reranker(),
      persistTrace: false,
    });

    expect(selectedGenerations).toEqual([
      { ownerId: "owner-a", generationId: "generation-a" },
    ]);
    expect(baseAliasRead).toBe(false);
    expect(result.vectorImplementation).toBe("fixture-generation-a");
    expect(result.candidates[0]?.chunkId).toBe("chunk-dense");
  });

  test("executes dense retrieval, RRF, reranking, expansion and bounded packing", async () => {
    const result = await hybridCorpusSearch(query("fail"), {
      client: fakeClient("fail") as never,
      lexical,
      runtime,
      reranker: reranker(),
      corpusGenerationId: "generation-fixture",
      persistTrace: false,
    });

    expect(result.retrievalMode).toBe("reranked");
    expect(result.vectorUsed).toBe(true);
    expect(result.rerankUsed).toBe(true);
    expect(result.candidates[0]?.chunkId).toBe("chunk-dense");
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chunkId: "chunk-lexical" }),
      ]),
    );
    expect(result.stages.map((entry) => entry.stage)).toEqual([
      "scope",
      "lexical",
      "dense",
      "fusion",
      "rerank",
      "diversity",
      "expansion",
      "packing",
    ]);
    expect(result.stages.every((entry) => entry.status === "used")).toBe(true);
  });

  test("does not admit dense evidence when consent changes during the provider request", async () => {
    for (const fallbackPolicy of ["lexical-only", "fail"] as const) {
      let authorized = true;
      let vectorSearches = 0;
      let markProviderStarted!: () => void;
      let releaseProvider!: () => void;
      const providerStarted = new Promise<void>((resolve) => {
        markProviderStarted = resolve;
      });
      const providerReleased = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      const revocableRuntime = {
        ...runtime,
        authorizeEmbedding: async () => {
          if (!authorized) throw new Error("fixture-consent-revoked");
        },
        embedding: {
          ...runtime.embedding,
          embedText: async (input: readonly { contentHash: string }[]) => {
            markProviderStarted();
            await providerReleased;
            return input.map((entry) => ({
              contentHash: entry.contentHash,
              values: [1, 0, 0],
            }));
          },
        },
        vector: {
          ...runtime.vector,
          forGeneration: () => ({
            capabilities: async () => ({
              available: true,
              implementation: "fixture-generation",
              dimensions: [3],
            }),
            search: async () => {
              vectorSearches += 1;
              return [
                {
                  sourceId: "source-b",
                  versionId: "version-b",
                  chunkId: "chunk-dense",
                  score: 0.99,
                },
              ];
            },
          }),
        },
      } as unknown as CorpusVectorRuntime;

      const pending = hybridCorpusSearch(query(fallbackPolicy), {
        client: fakeClient(fallbackPolicy) as never,
        lexical,
        runtime: revocableRuntime,
        reranker: reranker(),
        corpusGenerationId: "generation-fixture",
        persistTrace: false,
      });
      await providerStarted;
      authorized = false;
      releaseProvider();

      if (fallbackPolicy === "fail") {
        await expect(pending).rejects.toThrow("RETRIEVAL_DENSE_FAILED");
      } else {
        await expect(pending).resolves.toMatchObject({
          retrievalMode: "lexical",
          vectorUsed: false,
          fallbackReason: "dense:fixture-consent-revoked",
        });
      }
      expect(vectorSearches).toBe(0);
    }
  });

  test("keeps explicit attachments ahead of the project corpus after reranking", async () => {
    const result = await hybridCorpusSearch(
      {
        ...query("fail"),
        limit: 3,
        sourceIds: ["source-a"],
        contextAccess: "automatic",
      },
      {
        client: fakeClient("fail") as never,
        lexical,
        runtime,
        // This provider deliberately ranks the project-only dense result first.
        // Scope priority must still make the direct attachment pack first.
        reranker: reranker(),
        corpusGenerationId: "generation-fixture",
        persistTrace: false,
      },
    );

    expect(result.retrievalMode).toBe("reranked");
    expect(result.candidates[0]?.sourceId).toBe("source-a");
    expect(result.candidates[0]?.chunkId).toBe("chunk-lexical");
    expect(
      result.candidates.some((candidate) => candidate.sourceId === "source-b"),
    ).toBe(true);
    expect(
      result.stages.find((entry) => entry.stage === "packing")?.descriptorId,
    ).toBe("evidence-budget-explicit-first-v2");
  });

  test("preserves the best dense visual page when the text reranker cannot distinguish page titles", async () => {
    const visualPages = Array.from({ length: 30 }, (_, index) => {
      const page = index === 0 ? 27 : index <= 26 ? index : index + 1;
      return {
        sourceId: "source-scan",
        versionId: "version-scan",
        chunkId: `visual-page-${page}`,
        ordinal: page - 1,
        score: 1 - index / 100,
        snippet: "Cours de physique",
        locator: { kind: "pdf" as const, page },
        contentHash: page.toString(16).padStart(64, "0"),
        evidenceKind: "visual-only" as const,
      } satisfies LexicalCandidate;
    });
    const textPages = Array.from({ length: 8 }, (_, index) => ({
      sourceId: `source-text-${index}`,
      versionId: `version-text-${index}`,
      chunkId: `text-page-${index}`,
      ordinal: 0,
      score: 1 - index / 100,
      snippet: `Preuve textuelle ${index}`,
      locator: locator(`Preuve textuelle ${index}`),
      contentHash: (100 + index).toString(16).padStart(64, "0"),
      evidenceKind: "native-text" as const,
    }));
    const fixtureCandidates = [...visualPages, ...textPages];
    const fixtureTexts = new Map(
      fixtureCandidates.map((entry) => [entry.chunkId, entry.snippet]),
    );
    const visualRuntime = {
      ...runtime,
      vector: {
        ...runtime.vector,
        forGeneration: () => ({
          capabilities: async () => ({
            available: true,
            implementation: "fixture-visual-generation",
            dimensions: [3],
          }),
          search: async () =>
            visualPages.map((entry) => ({
              sourceId: entry.sourceId,
              versionId: entry.versionId,
              chunkId: entry.chunkId,
              score: entry.score,
            })),
        }),
      },
    } as unknown as CorpusVectorRuntime;
    const lexicalTextOnly = {
      search: async () => textPages,
    } as unknown as SqliteFts5LexicalSearchBackend;
    const rerankedIds: string[] = [];
    const equalScoreTextReranker: RerankProvider = {
      ...reranker(),
      rerank: async ({ operationId, candidates, topN }) => {
        rerankedIds.push(...candidates.map((entry) => entry.id));
        return [...candidates]
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, topN)
          .map((entry, rank) => ({
            operationId,
            candidateId: entry.id,
            rank,
            score: 0.5,
          }));
      },
    };

    const result = await hybridCorpusSearch(
      { ...query("fail"), limit: 12 },
      {
        client: fakeClient("fail", {
          candidates: fixtureCandidates,
          texts: fixtureTexts,
        }) as never,
        lexical: lexicalTextOnly,
        runtime: visualRuntime,
        reranker: equalScoreTextReranker,
        corpusGenerationId: "generation-visual-fixture",
        persistTrace: false,
      },
    );

    expect(rerankedIds).toHaveLength(8);
    expect(rerankedIds.every((id) => id.startsWith("text-page-"))).toBe(true);
    expect(result.candidates.slice(0, 4).map((entry) => entry.chunkId)).toEqual(
      ["visual-page-27", "visual-page-1", "visual-page-2", "visual-page-3"],
    );
    expect(
      result.candidates.some((entry) => entry.chunkId === "visual-page-27"),
    ).toBe(true);
    expect(result.retrievalMode).toBe("reranked");
  });

  test("retries an immutable visual attachment from its historical generation after source head advances", async () => {
    const snapshotPages = Array.from({ length: 30 }, (_, index) => {
      const page = index === 0 ? 27 : index <= 26 ? index : index + 1;
      return {
        sourceId: "source-scan",
        versionId: "version-snapshot-n",
        chunkId: `snapshot-page-${page}`,
        ordinal: page - 1,
        score: 1 - index / 100,
        snippet: "Cours de physique",
        locator: { kind: "pdf" as const, page },
        contentHash: (300 + page).toString(16).padStart(64, "0"),
        evidenceKind: "visual-only" as const,
      } satisfies LexicalCandidate;
    });
    const fixtureTexts = new Map(
      snapshotPages.map((entry) => [entry.chunkId, entry.snippet]),
    );
    const selectedGenerations: string[] = [];
    const historicalRuntime = {
      ...runtime,
      vector: {
        ...runtime.vector,
        forGeneration: (_ownerId: string, generationId: string) => {
          selectedGenerations.push(generationId);
          return {
            capabilities: async () => ({
              available: true,
              implementation: "fixture-historical-generation",
              dimensions: [3],
            }),
            search: async () =>
              snapshotPages.map((entry) => ({
                sourceId: entry.sourceId,
                versionId: entry.versionId,
                chunkId: entry.chunkId,
                score: entry.score,
              })),
          };
        },
      },
    } as unknown as CorpusVectorRuntime;

    const result = await hybridCorpusSearch(
      {
        ...query("hybrid-without-rerank"),
        projectIds: [],
        sourceIds: ["source-scan"],
        versionIds: ["version-snapshot-n"],
        contextAccess: "explicit-attachment",
        limit: 4,
      },
      {
        client: fakeClient("hybrid-without-rerank", {
          activeGenerationId: "generation-containing-snapshot-n",
          candidates: snapshotPages,
          texts: fixtureTexts,
        }) as never,
        lexical: { search: async () => [] },
        runtime: historicalRuntime,
        reranker: null,
        persistTrace: false,
      },
    );

    expect(selectedGenerations).toEqual(["generation-containing-snapshot-n"]);
    expect(result.retrievalMode).toBe("hybrid");
    expect(result.candidates[0]).toMatchObject({
      versionId: "version-snapshot-n",
      chunkId: "snapshot-page-27",
      locator: { kind: "pdf", page: 27 },
      evidenceKind: "visual-only",
    });
    expect(
      result.candidates.every(
        (candidate) => candidate.versionId === "version-snapshot-n",
      ),
    ).toBe(true);
  });

  test("merges visual snapshots pinned to different rebuilds without losing the dense page for an identical-title query", async () => {
    const pagesFor = (
      sourceId: string,
      versionId: string,
      prefix: string,
      relevantPage: number | null,
    ) =>
      Array.from({ length: 30 }, (_, index) => {
        const page =
          relevantPage === null
            ? index + 1
            : index === 0
              ? relevantPage
              : index < relevantPage
                ? index
                : index + 1;
        return {
          sourceId,
          versionId,
          chunkId: `${prefix}-page-${page}`,
          ordinal: page - 1,
          score: relevantPage === page ? 1 : 0.7 - index / 100,
          snippet: "Cours de physique",
          locator: { kind: "pdf" as const, page },
          contentHash: `${prefix.length}${page}`.padStart(64, "0"),
          evidenceKind: "visual-only" as const,
        } satisfies LexicalCandidate;
      });
    const firstSnapshot = pagesFor(
      "source-first-scan",
      "snapshot-first-n",
      "first-snapshot",
      null,
    );
    const laterSnapshot = pagesFor(
      "source-later-scan",
      "snapshot-later-n",
      "later-snapshot",
      27,
    );
    const fixtureCandidates = [...firstSnapshot, ...laterSnapshot];
    const fixtureTexts = new Map(
      fixtureCandidates.map((candidate) => [
        candidate.chunkId,
        "Cours de physique",
      ]),
    );
    const selectedGenerations: Array<{
      generationId: string;
      versionIds: readonly string[] | undefined;
    }> = [];
    const snapshotRuntime = {
      ...runtime,
      vector: {
        ...runtime.vector,
        forGeneration: (_ownerId: string, generationId: string) => ({
          capabilities: async () => ({
            available: true,
            implementation: "fixture-immutable-generation",
            dimensions: [3],
          }),
          search: async (vectorQuery: { versionIds?: readonly string[] }) => {
            selectedGenerations.push({
              generationId,
              versionIds: vectorQuery.versionIds,
            });
            return generationId === "rebuild-first"
              ? firstSnapshot.map((candidate) => ({
                  sourceId: candidate.sourceId,
                  versionId: candidate.versionId,
                  chunkId: candidate.chunkId,
                  score: candidate.score,
                }))
              : laterSnapshot.map((candidate) => ({
                  sourceId: candidate.sourceId,
                  versionId: candidate.versionId,
                  chunkId: candidate.chunkId,
                  score: candidate.score,
                }));
          },
        }),
      },
    } as unknown as CorpusVectorRuntime;

    const result = await hybridCorpusSearch(
      {
        ...query("hybrid-without-rerank"),
        query: "Cours de physique",
        projectIds: [],
        sourceIds: ["source-first-scan", "source-later-scan"],
        versionIds: ["snapshot-first-n", "snapshot-later-n"],
        contextAccess: "explicit-attachment",
        limit: 4,
      },
      {
        client: fakeClient("hybrid-without-rerank", {
          candidates: fixtureCandidates,
          texts: fixtureTexts,
          generationMemberships: [
            {
              generationId: "rebuild-first",
              versionId: "snapshot-first-n",
              state: "superseded",
              activatedAt: 100,
            },
            {
              generationId: "rebuild-later",
              versionId: "snapshot-later-n",
              state: "superseded",
              activatedAt: 200,
            },
          ],
        }) as never,
        lexical: { search: async () => [] },
        runtime: snapshotRuntime,
        reranker: null,
        persistTrace: false,
      },
    );

    expect(selectedGenerations).toEqual([
      {
        generationId: "rebuild-later",
        versionIds: ["snapshot-later-n"],
      },
      {
        generationId: "rebuild-first",
        versionIds: ["snapshot-first-n"],
      },
    ]);
    expect(result.retrievalMode).toBe("hybrid");
    expect(
      result.candidates.find(
        (candidate) => candidate.chunkId === "later-snapshot-page-27",
      ),
    ).toMatchObject({
      sourceId: "source-later-scan",
      versionId: "snapshot-later-n",
      chunkId: "later-snapshot-page-27",
      locator: { kind: "pdf", page: 27 },
      evidenceKind: "visual-only",
      channels: expect.arrayContaining(["dense"]),
    });
    expect(
      result.candidates.some(
        (candidate) => candidate.chunkId === "later-snapshot-page-27",
      ),
    ).toBe(true);
  });

  test("discards a multi-generation read when the owner consent fence changes between collections", async () => {
    const first = {
      sourceId: "source-first",
      versionId: "snapshot-first",
      chunkId: "snapshot-first-page",
      ordinal: 0,
      score: 1,
      snippet: "Cours de physique",
      locator: { kind: "pdf" as const, page: 1 },
      contentHash: "1".repeat(64),
      evidenceKind: "visual-only" as const,
    } satisfies LexicalCandidate;
    const second = {
      ...first,
      sourceId: "source-second",
      versionId: "snapshot-second",
      chunkId: "snapshot-second-page",
      contentHash: "2".repeat(64),
    } satisfies LexicalCandidate;
    let authorizationChecks = 0;
    const searchedGenerations: string[] = [];
    const fencedRuntime = {
      ...runtime,
      authorizeEmbedding: async () => {
        authorizationChecks += 1;
        if (authorizationChecks === 4) {
          throw new Error("CORPUS_EMBEDDING_PUBLICATION_FENCE_CHANGED");
        }
      },
      vector: {
        ...runtime.vector,
        forGeneration: (_ownerId: string, generationId: string) => ({
          capabilities: async () => ({
            available: true,
            implementation: "fixture-immutable-generation",
            dimensions: [3],
          }),
          search: async () => {
            searchedGenerations.push(generationId);
            const candidate =
              generationId === "generation-second" ? second : first;
            return [
              {
                sourceId: candidate.sourceId,
                versionId: candidate.versionId,
                chunkId: candidate.chunkId,
                score: candidate.score,
              },
            ];
          },
        }),
      },
    } as unknown as CorpusVectorRuntime;

    await expect(
      hybridCorpusSearch(
        {
          ...query("fail"),
          projectIds: [],
          sourceIds: [first.sourceId, second.sourceId],
          versionIds: [first.versionId, second.versionId],
          contextAccess: "explicit-attachment",
        },
        {
          client: fakeClient("fail", {
            candidates: [first, second],
            texts: new Map([
              [first.chunkId, first.snippet],
              [second.chunkId, second.snippet],
            ]),
            generationMemberships: [
              {
                generationId: "generation-first",
                versionId: first.versionId,
                state: "superseded",
                activatedAt: 100,
              },
              {
                generationId: "generation-second",
                versionId: second.versionId,
                state: "superseded",
                activatedAt: 200,
              },
            ],
          }) as never,
          lexical: { search: async () => [] },
          runtime: fencedRuntime,
          reranker: null,
          persistTrace: false,
        },
      ),
    ).rejects.toThrow("RETRIEVAL_DENSE_FAILED");
    expect(authorizationChecks).toBe(4);
    expect(searchedGenerations).toEqual(["generation-second"]);
  });

  test("keeps an all-visual dense window without requiring a multimodal reranker", async () => {
    const visualPages = [27, 4, 9].map((page, index) => ({
      sourceId: "source-scan",
      versionId: "version-scan",
      chunkId: `only-visual-page-${page}`,
      ordinal: page - 1,
      score: 1 - index / 10,
      snippet: "Cours de physique",
      locator: { kind: "pdf" as const, page },
      contentHash: (200 + page).toString(16).padStart(64, "0"),
      evidenceKind: "visual-only" as const,
    }));
    const fixtureTexts = new Map(
      visualPages.map((entry) => [entry.chunkId, entry.snippet]),
    );
    let rerankerCalled = false;
    const visualRuntime = {
      ...runtime,
      vector: {
        ...runtime.vector,
        forGeneration: () => ({
          capabilities: async () => ({
            available: true,
            implementation: "fixture-visual-generation",
            dimensions: [3],
          }),
          search: async () =>
            visualPages.map((entry) => ({
              sourceId: entry.sourceId,
              versionId: entry.versionId,
              chunkId: entry.chunkId,
              score: entry.score,
            })),
        }),
      },
    } as unknown as CorpusVectorRuntime;

    const result = await hybridCorpusSearch(
      { ...query("fail"), limit: 2 },
      {
        client: fakeClient("fail", {
          candidates: visualPages,
          texts: fixtureTexts,
        }) as never,
        lexical: { search: async () => [] },
        runtime: visualRuntime,
        reranker: {
          ...reranker(),
          rerank: async () => {
            rerankerCalled = true;
            throw new Error("text-reranker-must-not-receive-visual-evidence");
          },
        },
        corpusGenerationId: "generation-visual-only-fixture",
        persistTrace: false,
      },
    );

    expect(rerankerCalled).toBe(false);
    expect(result.rerankUsed).toBe(false);
    expect(result.retrievalMode).toBe("hybrid");
    expect(result.candidates.map((entry) => entry.chunkId)).toEqual([
      "only-visual-page-27",
      "only-visual-page-4",
    ]);
    expect(
      result.stages.find((entry) => entry.stage === "rerank"),
    ).toMatchObject({
      status: "skipped",
      safeReason: "visual-only-window",
    });
  });

  test("keeps the dense result and records degradation when reranking is unavailable", async () => {
    const result = await hybridCorpusSearch(query("hybrid-without-rerank"), {
      client: fakeClient("hybrid-without-rerank") as never,
      lexical,
      runtime,
      reranker: reranker({ fail: true }),
      corpusGenerationId: "generation-fixture",
      persistTrace: false,
    });

    expect(result.retrievalMode).toBe("hybrid");
    expect(result.vectorUsed).toBe(true);
    expect(result.rerankUsed).toBe(false);
    expect(result.fallbackReason).toBe("rerank:fixture-reranker-offline");
    expect(
      result.stages.find((entry) => entry.stage === "rerank"),
    ).toMatchObject({
      status: "degraded",
      safeReason: "fixture-reranker-offline",
    });
  });

  test("fails closed when an advanced project forbids reranker fallback", async () => {
    await expect(
      hybridCorpusSearch(query("fail"), {
        client: fakeClient("fail") as never,
        lexical,
        runtime,
        reranker: reranker({ fail: true }),
        corpusGenerationId: "generation-fixture",
        persistTrace: false,
      }),
    ).rejects.toThrow("RETRIEVAL_RERANK_FAILED");
  });

  test("fails closed when a fail-policy project contains a source outside the Core embedding plane", async () => {
    await expect(
      hybridCorpusSearch(query("fail"), {
        client: fakeClient("fail", {
          unsupportedEmbeddingPlacement: true,
        }) as never,
        lexical,
        runtime,
        reranker: reranker(),
        corpusGenerationId: "generation-fixture",
        persistTrace: false,
      }),
    ).rejects.toThrow("RETRIEVAL_DENSE_FAILED");
  });

  test("a fail-closed advanced project remains authoritative in a mixed project scope", async () => {
    await expect(
      hybridCorpusSearch(
        {
          ...query("lexical-only"),
          projectIds: ["project-a", "project-lexical"],
        },
        {
          client: fakeClient("lexical-only", {
            projects: [
              {
                id: "project-a",
                retrievalMode: "advanced-auto",
                retrievalFallbackPolicy: "fail",
                embeddingSpaceId,
                rerankSpaceId,
              },
              {
                id: "project-lexical",
                retrievalMode: "lexical-only",
                retrievalFallbackPolicy: "lexical-only",
                embeddingSpaceId: null,
                rerankSpaceId: null,
              },
            ],
          }) as never,
          lexical,
          runtime,
          reranker: reranker(),
          corpusGenerationId: "generation-fixture",
          persistTrace: false,
        },
      ),
    ).rejects.toThrow("RETRIEVAL_DENSE_FAILED");
  });

  test("uses hybrid-without-rerank only when dense retrieval is compatible and actually succeeds", async () => {
    let rerankerCalled = false;
    const result = await hybridCorpusSearch(query("hybrid-without-rerank"), {
      client: fakeClient("hybrid-without-rerank", {
        projects: [
          {
            id: "project-a",
            retrievalMode: "advanced-auto",
            retrievalFallbackPolicy: "hybrid-without-rerank",
            embeddingSpaceId,
            rerankSpaceId: null,
          },
        ],
      }) as never,
      lexical,
      runtime,
      reranker: {
        ...reranker(),
        rerank: async () => {
          rerankerCalled = true;
          throw new Error("reranker-must-not-run");
        },
      },
      corpusGenerationId: "generation-fixture",
      persistTrace: false,
    });

    expect(result.retrievalMode).toBe("hybrid");
    expect(result.vectorUsed).toBe(true);
    expect(result.rerankUsed).toBe(false);
    expect(rerankerCalled).toBe(false);
    expect(result.fallbackReason).toBe(
      "rerank:rerank-project-space-not-configured",
    );
  });

  test("falls back to lexical instead of claiming hybrid when the dense runtime is unavailable", async () => {
    const result = await hybridCorpusSearch(query("hybrid-without-rerank"), {
      client: fakeClient("hybrid-without-rerank", {
        projects: [
          {
            id: "project-a",
            retrievalMode: "advanced-auto",
            retrievalFallbackPolicy: "hybrid-without-rerank",
            embeddingSpaceId,
            rerankSpaceId: null,
          },
        ],
      }) as never,
      lexical,
      runtime: null,
      reranker: reranker(),
      corpusGenerationId: "generation-fixture",
      persistTrace: false,
    });

    expect(result).toMatchObject({
      retrievalMode: "lexical",
      vectorUsed: false,
      rerankUsed: false,
      fallbackReason: "dense:dense-provider-unavailable",
    });
    expect(
      result.stages.find((entry) => entry.stage === "dense"),
    ).toMatchObject({
      status: "degraded",
      safeReason: "dense-provider-unavailable",
    });
  });
});
