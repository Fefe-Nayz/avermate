import type { Client, InValue } from "@libsql/client";
import {
  lexicalCandidateSchema,
  sourceLocatorV1Schema,
  type LexicalCandidate,
  type LexicalSearchBackend,
  type OwnedLexicalQuery,
  type RerankProvider,
  type RetrievalFallbackPolicy,
  type RetrievalStageTrace,
  type VectorCandidate,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { newId } from "../lib/id";
import {
  RoutedCorpusContentReader,
  type AuthorizedCorpusChunkRow,
} from "./corpus-content-reader";
import { SqliteFts5LexicalSearchBackend } from "./lexical";
import { routedCorpusStore } from "./routed-corpus-store";
import {
  deduplicateRetrievalCandidates,
  diversifyRetrievalCandidates,
  expandParentAndNeighbors,
  packRetrievalContext,
  rerankRetrievalCandidates,
  retrievalScopeDigest,
  type PolicyCandidate,
} from "./retrieval-policy";
import { createOwnedConfiguredRerankProvider } from "./retrieval-runtime";
import { reciprocalRankFusion } from "./vector";
import {
  createOwnedCorpusVectorRuntime,
  type CorpusVectorRuntime,
} from "./vector-runtime";
import { estimateTokens, jsonValue, sha256 } from "./values";

type SqlClient = Pick<Client, "execute" | "transaction">;

const LEXICAL_POOL = 80;
const DENSE_POOL = 80;
const RERANK_WINDOW = 50;

function vectorSnippet(text: string) {
  const trimmed = text.trim();
  const bounded = trimmed.slice(0, 520);
  return `${bounded}${trimmed.length > bounded.length ? "…" : ""}`;
}

function missingRetrievalSchema(error: unknown) {
  const message = String(error).toLocaleLowerCase("en");
  return (
    message.includes("no such table: retrieval_traces") ||
    message.includes("no such table: corpus_embedding_generations")
  );
}

function authorizationSql(input: OwnedLexicalQuery, args: InValue[]) {
  const clauses = ["sources.userId = ?"];
  args.push(input.ownerId);
  if (input.projectIds.length === 0) {
    clauses.push("sources.currentVersionId = versions.id");
  } else {
    clauses.push(`EXISTS (
      SELECT 1
      FROM study_project_items AS project_items
      JOIN study_projects AS projects ON projects.id = project_items.projectId
      WHERE projects.userId = ?
        AND projects.deletedAt IS NULL
        AND project_items.kind = sources.originKind
        AND project_items.referenceId = sources.originId
        AND project_items.contextMode != 'exclude'
        AND project_items.selectorReviewRequired = 0
        AND (
          (project_items.trackingMode = 'pinned'
            AND project_items.sourceVersionId = versions.id)
          OR (project_items.trackingMode = 'follow-head'
            AND sources.currentVersionId = versions.id)
        )
        AND project_items.projectId IN (${input.projectIds.map(() => "?").join(", ")})
    )`);
    args.push(input.ownerId, ...input.projectIds);
  }
  const addList = (column: string, values: readonly string[]) => {
    if (values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
    args.push(...values);
  };
  addList("sources.yearId", input.yearIds);
  addList("sources.subjectId", input.subjectIds);
  addList("sources.originKind", input.originKinds);
  return clauses.join(" AND ");
}

function policyFromLexical(candidates: readonly LexicalCandidate[]) {
  return candidates.map<PolicyCandidate>((candidate, index) => ({
    ...candidate,
    channels: ["lexical"],
    fusedScore: 1 / (61 + index),
  }));
}

async function projectRetrievalPolicy(
  client: SqlClient,
  input: OwnedLexicalQuery,
) {
  if (input.projectIds.length === 0) {
    return {
      advanced: true,
      fallback: input.fallbackPolicy ?? ("lexical-only" as const),
      embeddingSpaceId: null,
      rerankSpaceId: null,
    };
  }
  const ids = [...new Set(input.projectIds)];
  const rows = await client.execute({
    sql: `SELECT id, retrievalMode, retrievalFallbackPolicy,
        embeddingSpaceId, rerankSpaceId
      FROM study_projects
      WHERE userId = ? AND deletedAt IS NULL
        AND id IN (${ids.map(() => "?").join(", ")})`,
    args: [input.ownerId, ...ids],
  });
  const embeddingSpaceIds = new Set(
    rows.rows.flatMap((row) =>
      row.embeddingSpaceId === null ? [] : [String(row.embeddingSpaceId)],
    ),
  );
  const rerankSpaceIds = new Set(
    rows.rows.flatMap((row) =>
      row.rerankSpaceId === null ? [] : [String(row.rerankSpaceId)],
    ),
  );
  const advanced =
    rows.rows.length === ids.length &&
    rows.rows.every((row) => row.retrievalMode === "advanced-auto") &&
    embeddingSpaceIds.size === 1 &&
    rerankSpaceIds.size === 1;
  const policies = rows.rows.map((row) => String(row.retrievalFallbackPolicy));
  const fallback: RetrievalFallbackPolicy = input.fallbackPolicy
    ? input.fallbackPolicy
    : policies.includes("lexical-only")
      ? "lexical-only"
      : policies.includes("fail")
        ? "fail"
        : policies.includes("hybrid-without-rerank")
          ? "hybrid-without-rerank"
          : "lexical-only";
  return {
    advanced,
    fallback,
    embeddingSpaceId: [...embeddingSpaceIds][0] ?? null,
    rerankSpaceId: [...rerankSpaceIds][0] ?? null,
  };
}

/**
 * Hydrate vector identifiers only after a metadata-only ownership/version check,
 * then repeat that exact fence before selecting any body text.
 */
export async function hydrateOwnedVectorCandidates(
  candidates: readonly VectorCandidate[],
  input: OwnedLexicalQuery,
  client: SqlClient = db.$client,
): Promise<LexicalCandidate[]> {
  if (candidates.length === 0) return [];
  const ids = [...new Set(candidates.map((entry) => entry.chunkId))].slice(0, 800);
  const metadataArgs: InValue[] = [];
  const metadataAuthorization = authorizationSql(input, metadataArgs);
  metadataArgs.push(...ids);
  const metadata = await client.execute({
    sql: `SELECT chunks.id AS chunkId, chunks.versionId, chunks.ordinal,
        chunks.contentHash, chunks.locatorJson, chunks.evidenceKind,
        versions.sourceId
      FROM content_chunks AS chunks
      JOIN content_versions AS versions ON versions.id = chunks.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      WHERE ${metadataAuthorization}
        AND chunks.id IN (${ids.map(() => "?").join(", ")})`,
    args: metadataArgs,
  });
  if (metadata.rows.length === 0) return [];
  const authorizedIds = metadata.rows.map((row) => String(row.chunkId));
  const bodyArgs: InValue[] = [];
  const bodyAuthorization = authorizationSql(input, bodyArgs);
  bodyArgs.push(...authorizedIds);
  const bodies = await client.execute({
    sql: `SELECT chunks.id, chunks.text, chunks.normalizedText,
        chunks.contentHash, chunks.headingPathJson, sources.userId,
        sources.placement, sources.placementRef
      FROM content_chunks AS chunks
      JOIN content_versions AS versions ON versions.id = chunks.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      WHERE ${bodyAuthorization}
        AND chunks.id IN (${authorizedIds.map(() => "?").join(", ")})`,
    args: bodyArgs,
  });
  const bodyById = await new RoutedCorpusContentReader(client).hydrate(
    bodies.rows as unknown as AuthorizedCorpusChunkRow[],
  );
  const scoreById = new Map<string, number>();
  for (const candidate of candidates) {
    scoreById.set(
      candidate.chunkId,
      Math.max(scoreById.get(candidate.chunkId) ?? -Infinity, candidate.score),
    );
  }
  return metadata.rows
    .flatMap((row) => {
      const chunkId = String(row.chunkId);
      const body = bodyById.get(chunkId);
      if (!body) return [];
      return [
        lexicalCandidateSchema.parse({
          sourceId: String(row.sourceId),
          versionId: String(row.versionId),
          chunkId,
          ordinal: Number(row.ordinal),
          score: scoreById.get(chunkId) ?? 0,
          snippet: vectorSnippet(body.text),
          locator: sourceLocatorV1Schema.parse(jsonValue(row.locatorJson)),
          contentHash: String(row.contentHash),
          evidenceKind: row.evidenceKind,
        }),
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.chunkId.localeCompare(right.chunkId),
    );
}

async function hydrateAuthorizedBodies(
  client: SqlClient,
  input: OwnedLexicalQuery,
  candidates: readonly PolicyCandidate[],
) {
  if (candidates.length === 0) return [];
  const ids = [...new Set(candidates.map((candidate) => candidate.chunkId))];
  const args: InValue[] = [];
  const authorization = authorizationSql(input, args);
  args.push(...ids);
  const rows = await client.execute({
    sql: `SELECT chunks.id, chunks.text, chunks.normalizedText,
        chunks.tokenEstimate, chunks.contentHash, chunks.headingPathJson,
        sources.userId, sources.placement, sources.placementRef
      FROM content_chunks AS chunks
      JOIN content_versions AS versions ON versions.id = chunks.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      WHERE ${authorization}
        AND chunks.id IN (${ids.map(() => "?").join(", ")})`,
    args,
  });
  const hydrated = await new RoutedCorpusContentReader(client).hydrate(
    rows.rows as unknown as AuthorizedCorpusChunkRow[],
  );
  const bodyById = new Map(
    rows.rows.map((row) => [
      String(row.id),
      {
        text: hydrated.get(String(row.id))?.text,
        tokenEstimate: Number(row.tokenEstimate),
        headingPath: hydrated.get(String(row.id))?.headingPath,
      },
    ]),
  );
  return candidates.flatMap((candidate) => {
    const body = bodyById.get(candidate.chunkId);
    return body?.text !== undefined ? [{ ...candidate, ...body }] : [];
  });
}

async function authorizedNeighborUniverse(
  client: SqlClient,
  input: OwnedLexicalQuery,
  winners: readonly PolicyCandidate[],
) {
  if (winners.length === 0) return [];
  const windows = new Map<string, { minimum: number; maximum: number }>();
  for (const winner of winners) {
    const current = windows.get(winner.versionId);
    windows.set(winner.versionId, {
      minimum: Math.max(0, Math.min(current?.minimum ?? Infinity, winner.ordinal - 1)),
      maximum: Math.max(current?.maximum ?? -Infinity, winner.ordinal + 1),
    });
  }
  const args: InValue[] = [];
  const authorization = authorizationSql(input, args);
  const windowSql = [...windows].map(([versionId, window]) => {
    args.push(versionId, window.minimum, window.maximum);
    return "(chunks.versionId = ? AND chunks.ordinal BETWEEN ? AND ?)";
  });
  const rows = await client.execute({
    sql: `SELECT chunks.id AS chunkId, chunks.versionId, chunks.ordinal,
        chunks.text, chunks.normalizedText, chunks.tokenEstimate, chunks.contentHash,
        chunks.locatorJson, chunks.headingPathJson, chunks.evidenceKind,
        versions.sourceId, sources.userId, sources.placement,
        sources.placementRef
      FROM content_chunks AS chunks
      JOIN content_versions AS versions ON versions.id = chunks.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      WHERE ${authorization} AND (${windowSql.join(" OR ")})
      ORDER BY chunks.versionId, chunks.ordinal, chunks.id
      LIMIT 1000`,
    args,
  });
  const hydrated = await new RoutedCorpusContentReader(client).hydrate(
    rows.rows as unknown as AuthorizedCorpusChunkRow[],
  );
  return rows.rows.flatMap<PolicyCandidate>((row) => {
    const body = hydrated.get(String(row.chunkId));
    if (!body) return [];
    return [{
      ...lexicalCandidateSchema.parse({
        sourceId: String(row.sourceId),
        versionId: String(row.versionId),
        chunkId: String(row.chunkId),
        ordinal: Number(row.ordinal),
        score: 0,
        snippet: vectorSnippet(body.text),
        locator: sourceLocatorV1Schema.parse(jsonValue(row.locatorJson)),
        contentHash: String(row.contentHash),
        evidenceKind: row.evidenceKind,
      }),
      channels: [],
      fusedScore: 0,
      text: body.text,
      tokenEstimate: Number(row.tokenEstimate),
      headingPath: body.headingPath,
    }];
  });
}

async function activeGenerationId(
  client: SqlClient,
  ownerId: string,
  spaceId: string,
) {
  try {
    const rows = await client.execute({
      sql: `SELECT id FROM corpus_embedding_generations
        WHERE userId = ? AND spaceId = ? AND state = 'active'
        LIMIT 1`,
      args: [ownerId, spaceId],
    });
    return rows.rows[0] ? String(rows.rows[0].id) : null;
  } catch (error) {
    if (missingRetrievalSchema(error)) return null;
    throw error;
  }
}

async function persistTrace(
  client: SqlClient,
  input: {
    operationId: string;
    ownerId: string;
    queryDigest: string;
    corpusGenerationId: string | null;
    scopeDigest: string;
    stages: readonly RetrievalStageTrace[];
    fallbackPolicy: RetrievalFallbackPolicy;
    fallbackReason: string | null;
    packedEvidenceIds: readonly string[];
    evaluationCorrelationId: string | null;
  },
) {
  try {
    await client.execute({
      sql: `INSERT INTO retrieval_traces (
          id, operationId, userId, queryDigest, corpusGenerationId,
          scopeDigest, stagesJson, fallbackPolicy, fallbackReason,
          packedEvidenceIdsJson, evaluationCorrelationId, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        newId("rtrace"),
        input.operationId,
        input.ownerId,
        input.queryDigest,
        input.corpusGenerationId,
        input.scopeDigest,
        JSON.stringify(input.stages),
        input.fallbackPolicy,
        input.fallbackReason,
        JSON.stringify(input.packedEvidenceIds),
        input.evaluationCorrelationId,
        Math.floor(Date.now() / 1_000),
      ],
    });
  } catch (error) {
    // Migration 0061 installs the trace schema after the coordinated schema lots.
    if (!missingRetrievalSchema(error)) throw error;
  }
}

export type HybridSearchResult = {
  candidates: readonly LexicalCandidate[];
  vectorUsed: boolean;
  vectorImplementation: string | null;
  rerankUsed: boolean;
  rerankImplementation: string | null;
  retrievalMode: "lexical" | "hybrid" | "reranked";
  fallbackReason: string | null;
  operationId: string;
  stages: readonly RetrievalStageTrace[];
};

export async function hybridCorpusSearch(
  input: OwnedLexicalQuery,
  options: {
    client?: SqlClient;
    lexical?: Pick<LexicalSearchBackend, "search">;
    runtime?: CorpusVectorRuntime | null;
    reranker?: RerankProvider | null;
    signal?: AbortSignal;
    /** Test/paired-node runtimes can provide their already selected generation. */
    corpusGenerationId?: string | null;
    persistTrace?: boolean;
  } = {},
): Promise<HybridSearchResult> {
  const client = options.client ?? db.$client;
  const lexical =
    options.lexical ??
    (client === db.$client
      ? routedCorpusStore
      : new SqliteFts5LexicalSearchBackend(client));
  const signal = options.signal ?? new AbortController().signal;
  const operationId = input.operationId ?? newId("retrieval");
  const queryDigest = sha256(input.query);
  const scopeDigest = retrievalScopeDigest(input);
  const stages: RetrievalStageTrace[] = [];
  let fallbackReason: string | null = null;
  let corpusGenerationId: string | null = options.corpusGenerationId ?? null;
  const stage = (
    name: RetrievalStageTrace["stage"],
    descriptorId: string | null,
    inputCount: number,
    outputCount: number,
    startedAt: number,
    status: RetrievalStageTrace["status"],
    safeReason: string | null = null,
  ) => {
    stages.push({
      stage: name,
      descriptorId,
      inputCount,
      outputCount,
      durationMs: Math.max(0, Date.now() - startedAt),
      status,
      safeReason,
    });
  };
  const trace = async (packedEvidenceIds: readonly string[] = []) => {
    if (options.persistTrace === false) return;
    await persistTrace(client, {
      operationId,
      ownerId: input.ownerId,
      queryDigest,
      corpusGenerationId,
      scopeDigest,
      stages,
      fallbackPolicy,
      fallbackReason,
      packedEvidenceIds,
      evaluationCorrelationId: input.evaluationCorrelationId ?? null,
    });
  };

  const scopeStarted = Date.now();
  const {
    advanced,
    fallback: fallbackPolicy,
    embeddingSpaceId,
    rerankSpaceId,
  } = await projectRetrievalPolicy(client, input);
  stage("scope", null, input.projectIds.length, input.projectIds.length, scopeStarted, "used");

  const lexicalStarted = Date.now();
  const lexicalCandidates = await lexical.search({
    ...input,
    limit: Math.min(LEXICAL_POOL, Math.max(input.limit, LEXICAL_POOL)),
  });
  stage("lexical", "sqlite-fts5-unicode61-v1", 1, lexicalCandidates.length, lexicalStarted, "used");

  const lexicalOnly = async (reason: string | null = null) => {
    fallbackReason = reason;
    const diversityStarted = Date.now();
    const selected = diversifyRetrievalCandidates(
      deduplicateRetrievalCandidates(policyFromLexical(lexicalCandidates)),
      { limit: Math.min(RERANK_WINDOW, Math.max(input.limit, input.limit * 2)) },
    );
    stage("diversity", "round-robin-source-locator-v1", lexicalCandidates.length, selected.length, diversityStarted, "used");
    const bodies = await hydrateAuthorizedBodies(client, input, selected);
    const expansionStarted = Date.now();
    const neighbors = await authorizedNeighborUniverse(client, input, bodies.slice(0, input.limit));
    const expanded = expandParentAndNeighbors(bodies.slice(0, input.limit), [...bodies, ...neighbors]);
    stage("expansion", "parent-neighbor-radius-1-v1", bodies.length, expanded.length, expansionStarted, "used");
    const packingStarted = Date.now();
    const packed = packRetrievalContext(expanded, {
      maximumTokens: 12_000,
      maximumUtf8Bytes: 64 * 1024,
      maximumVisualItems: 8,
      maximumEvidenceItems: input.limit,
    });
    stage("packing", "evidence-budget-v1", expanded.length, packed.packed.length, packingStarted, "used");
    await trace(packed.packed.map((candidate) => candidate.chunkId));
    return {
      candidates: packed.packed,
      vectorUsed: false,
      vectorImplementation: null,
      rerankUsed: false,
      rerankImplementation: null,
      retrievalMode: "lexical" as const,
      fallbackReason,
      operationId,
      stages,
    };
  };

  // Exact/phrase/prefix/cursor behavior remains lexical, as does any project
  // that has not explicitly opted into advanced automatic retrieval.
  if (input.mode !== "terms" || input.cursor || !advanced) {
    stage("dense", null, 0, 0, Date.now(), "skipped", "lexical-policy");
    stage("fusion", null, 0, 0, Date.now(), "skipped", "lexical-policy");
    stage("rerank", null, 0, 0, Date.now(), "skipped", "lexical-policy");
    return lexicalOnly(null);
  }

  let runtime: CorpusVectorRuntime | null = null;
  let vectorImplementation: string | null = null;
  let denseCandidates: LexicalCandidate[] = [];
  const denseStarted = Date.now();
  try {
    runtime =
      options.runtime === undefined
        ? await createOwnedCorpusVectorRuntime(input.ownerId)
        : options.runtime;
    if (!runtime) throw new Error("dense-provider-unavailable");
    if (
      embeddingSpaceId &&
      runtime.embedding.descriptor().id !== embeddingSpaceId
    ) {
      throw new Error("dense-project-space-not-configured");
    }
    const capabilities = await runtime.vector.capabilities();
    vectorImplementation = capabilities.implementation;
    if (!capabilities.available) throw new Error("dense-index-unavailable");
    if (options.runtime === undefined) {
      corpusGenerationId = await activeGenerationId(
        client,
        input.ownerId,
        runtime.embedding.descriptor().id,
      );
      if (!corpusGenerationId) throw new Error("dense-generation-unavailable");
    }
    const context = runtime.consent
      ? { operationId, signal, consent: runtime.consent }
      : undefined;
    const [queryVector] = await runtime.embedding.embedText(
      [
        {
          contentHash: queryDigest,
          text: input.query,
          purpose: "query",
        },
      ],
      context,
    );
    if (!queryVector) throw new Error("dense-query-vector-missing");
    const raw = await runtime.vector.search({
      ownerId: input.ownerId,
      spaceId: runtime.embedding.descriptor().id,
      values: queryVector.values,
      limit: DENSE_POOL,
    });
    denseCandidates = await hydrateOwnedVectorCandidates(raw, input, client);
    stage("dense", runtime.embedding.descriptor().id, 1, denseCandidates.length, denseStarted, "used");
  } catch (error) {
    signal.throwIfAborted();
    const reason = error instanceof Error ? error.message.slice(0, 200) : "dense-failed";
    stage("dense", runtime?.embedding.descriptor().id ?? null, 1, 0, denseStarted, fallbackPolicy === "fail" ? "failed" : "degraded", reason);
    fallbackReason = `dense:${reason}`;
    stage("fusion", null, 0, 0, Date.now(), "skipped", "dense-unavailable");
    stage("rerank", null, 0, 0, Date.now(), "skipped", "dense-unavailable");
    if (fallbackPolicy === "fail") {
      await trace();
      throw new Error("RETRIEVAL_DENSE_FAILED");
    }
    return lexicalOnly(fallbackReason);
  }

  const fusionStarted = Date.now();
  const fused = reciprocalRankFusion({
    lexical: lexicalCandidates,
    vector: denseCandidates,
  });
  const lexicalById = new Map(lexicalCandidates.map((entry) => [entry.chunkId, entry]));
  const denseById = new Map(denseCandidates.map((entry) => [entry.chunkId, entry]));
  const fusedCandidates = fused.flatMap<PolicyCandidate>((ranked) => {
    const candidate = lexicalById.get(ranked.chunkId) ?? denseById.get(ranked.chunkId);
    if (!candidate) return [];
    return [{
      ...candidate,
      channels: ranked.channels.map((channel) => channel === "vector" ? "dense" as const : "lexical" as const),
      fusedScore: ranked.score,
    }];
  });
  const deduplicated = deduplicateRetrievalCandidates(fusedCandidates);
  stage("fusion", "weighted-rrf-k60-v1", lexicalCandidates.length + denseCandidates.length, deduplicated.length, fusionStarted, "used");

  const diversityStarted = Date.now();
  let selected = diversifyRetrievalCandidates(deduplicated, {
    limit: RERANK_WINDOW,
    maximumPerSource: 4,
    maximumPerLocator: 2,
  });
  stage("diversity", "round-robin-source-locator-v1", deduplicated.length, selected.length, diversityStarted, "used");
  selected = await hydrateAuthorizedBodies(client, input, selected);

  let rerankUsed = false;
  let rerankImplementation: string | null = null;
  const rerankStarted = Date.now();
  try {
    const reranker =
      options.reranker === undefined
        ? await createOwnedConfiguredRerankProvider(input.ownerId)
        : options.reranker;
    if (!reranker) throw new Error("rerank-provider-unavailable");
    if (rerankSpaceId && reranker.descriptor().id !== rerankSpaceId) {
      throw new Error("rerank-project-space-not-configured");
    }
    rerankImplementation = reranker.descriptor().id;
    selected = await rerankRetrievalCandidates({
      operationId,
      query: input.query,
      candidates: selected,
      provider: reranker,
      topN: Math.min(input.limit, selected.length),
      signal,
    });
    rerankUsed = true;
    stage("rerank", rerankImplementation, deduplicated.length, selected.length, rerankStarted, "used");
  } catch (error) {
    signal.throwIfAborted();
    const reason = error instanceof Error ? error.message.slice(0, 200) : "rerank-failed";
    stage("rerank", rerankImplementation, selected.length, 0, rerankStarted, fallbackPolicy === "fail" ? "failed" : "degraded", reason);
    fallbackReason = `rerank:${reason}`;
    if (fallbackPolicy === "fail") {
      await trace();
      throw new Error("RETRIEVAL_RERANK_FAILED");
    }
    if (fallbackPolicy === "lexical-only") {
      const lexicalSelected = diversifyRetrievalCandidates(
        deduplicateRetrievalCandidates(policyFromLexical(lexicalCandidates)),
        { limit: Math.min(RERANK_WINDOW, Math.max(input.limit, input.limit * 2)) },
      );
      selected = await hydrateAuthorizedBodies(client, input, lexicalSelected);
    }
  }

  const winners = selected.slice(0, input.limit);
  const expansionStarted = Date.now();
  const neighbors = await authorizedNeighborUniverse(client, input, winners);
  const expanded = expandParentAndNeighbors(winners, [...selected, ...neighbors]);
  stage("expansion", "parent-neighbor-radius-1-v1", winners.length, expanded.length, expansionStarted, "used");
  const packingStarted = Date.now();
  const packed = packRetrievalContext(expanded, {
    maximumTokens: 12_000,
    maximumUtf8Bytes: 64 * 1024,
    maximumVisualItems: 8,
    maximumEvidenceItems: input.limit,
  });
  stage("packing", "evidence-budget-v1", expanded.length, packed.packed.length, packingStarted, "used");
  await trace(packed.packed.map((candidate) => candidate.chunkId));
  const vectorUsed = fallbackReason?.startsWith("rerank:")
    ? fallbackPolicy === "hybrid-without-rerank"
    : true;
  return {
    candidates: packed.packed,
    vectorUsed,
    vectorImplementation,
    rerankUsed,
    rerankImplementation,
    retrievalMode: rerankUsed ? "reranked" : vectorUsed ? "hybrid" : "lexical",
    fallbackReason,
    operationId,
    stages,
  };
}
