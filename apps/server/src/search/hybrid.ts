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
import {
  estimateTokens,
  jsonValue,
  normalizeForSearch,
  sha256,
} from "./values";
import { sourceOrProjectScopeSql } from "./context-access";
import {
  assertEmbeddingPublicationFence,
  readEmbeddingPublicationFence,
  type EmbeddingPublicationFence,
} from "./embedding-publication-fence";

type SqlClient = Pick<Client, "execute" | "transaction">;

const LEXICAL_POOL = 80;
const DENSE_POOL = 80;
const RERANK_WINDOW = 50;
const QUESTION_STOP_WORDS = new Set([
  "avec",
  "cette",
  "dans",
  "des",
  "document",
  "explique",
  "faire",
  "jointe",
  "les",
  "pour",
  "pourquoi",
  "que",
  "quelle",
  "quelles",
  "quels",
  "signifie",
  "source",
  "sont",
  "the",
  "une",
  "what",
  "with",
]);

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
  const scopedSources = sourceOrProjectScopeSql({
    ...input,
    args,
    sourceSql: (placeholders) =>
      `(sources.id IN (${placeholders}) AND sources.currentVersionId = versions.id)`,
    projectSql: (contextModeSql) => ({
      sql: `EXISTS (
        SELECT 1
        FROM study_project_items AS project_items
        JOIN study_projects AS projects ON projects.id = project_items.projectId
        WHERE projects.userId = ?
          AND projects.deletedAt IS NULL
          AND project_items.kind = sources.originKind
          AND project_items.referenceId = sources.originId
          AND ${contextModeSql}
          AND project_items.selectorReviewRequired = 0
          AND (
            (project_items.trackingMode = 'pinned'
              AND project_items.sourceVersionId = versions.id)
            OR (project_items.trackingMode = 'follow-head'
              AND sources.currentVersionId = versions.id)
          )
          AND project_items.projectId IN (${input.projectIds.map(() => "?").join(", ")})
      )`,
      args: [input.ownerId, ...input.projectIds],
    }),
  });
  clauses.push(scopedSources ?? "sources.currentVersionId = versions.id");
  const addList = (column: string, values: readonly string[]) => {
    if (values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
    args.push(...values);
  };
  addList("sources.yearId", input.yearIds);
  addList("sources.subjectId", input.subjectIds);
  addList("sources.originKind", input.originKinds);
  addList("versions.id", input.versionIds ?? []);
  return clauses.join(" AND ");
}

function policyFromLexical(candidates: readonly LexicalCandidate[]) {
  return candidates.map<PolicyCandidate>((candidate, index) => ({
    ...candidate,
    channels: ["lexical"],
    fusedScore: 1 / (61 + index),
  }));
}

/**
 * Keep provider scores intact while making the user's direct attachments the
 * first packing tier. The sort is stable, so relevance order within each tier
 * remains exactly the order produced by lexical/RRF/rerank.
 */
function prioritizeExplicitSources<T extends { sourceId: string }>(
  candidates: readonly T[],
  sourceIds: readonly string[] | undefined,
) {
  const explicit = new Set(sourceIds ?? []);
  if (explicit.size === 0) return [...candidates];
  return [...candidates].sort(
    (left, right) =>
      Number(explicit.has(right.sourceId)) -
      Number(explicit.has(left.sourceId)),
  );
}

function relaxedQuestionTerms(query: string) {
  const unique = new Map<string, number>();
  for (const [index, term] of (
    normalizeForSearch(query).match(/[\p{L}\p{N}_]+/gu) ?? []
  ).entries()) {
    if (term.length < 3 || QUESTION_STOP_WORDS.has(term)) continue;
    if (!unique.has(term)) unique.set(term, index);
  }
  return [...unique]
    .sort(
      ([left, leftIndex], [right, rightIndex]) =>
        right.length - left.length || leftIndex - rightIndex,
    )
    .slice(0, 8)
    .map(([term]) => term);
}

async function lexicalQuestionSearch(
  lexical: Pick<LexicalSearchBackend, "search">,
  input: OwnedLexicalQuery,
) {
  const primary = await lexical.search(input);
  if (primary.length > 0 || input.mode !== "terms" || input.cursor !== null) {
    return { candidates: primary, queryCount: 1 };
  }
  const terms = relaxedQuestionTerms(input.query);
  if (terms.length <= 1) return { candidates: primary, queryCount: 1 };
  const ranked = new Map<
    string,
    { candidate: LexicalCandidate; score: number }
  >();
  for (const term of terms) {
    const candidates = await lexical.search({
      ...input,
      query: term,
      limit: Math.min(24, input.limit),
    });
    for (const [index, candidate] of candidates.entries()) {
      const current = ranked.get(candidate.chunkId);
      const score = (current?.score ?? 0) + 1 / (61 + index);
      ranked.set(candidate.chunkId, {
        candidate: current?.candidate ?? candidate,
        score,
      });
    }
  }
  return {
    candidates: [...ranked.values()]
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidate.chunkId.localeCompare(right.candidate.chunkId),
      )
      .map(({ candidate, score }) => ({ ...candidate, score }))
      .slice(0, input.limit),
    queryCount: 1 + terms.length,
  };
}

async function explicitSourceOverview(
  client: SqlClient,
  input: OwnedLexicalQuery,
) {
  if ((input.sourceIds?.length ?? 0) === 0) return [];
  const args: InValue[] = [];
  const authorization = authorizationSql(input, args);
  const sourceIds = [...new Set(input.sourceIds ?? [])];
  args.push(...sourceIds);
  const rows = await client.execute({
    sql: `WITH ranked AS (
        SELECT chunks.id AS chunkId, chunks.versionId, chunks.ordinal,
          chunks.text, chunks.normalizedText, chunks.tokenEstimate,
          chunks.contentHash, chunks.locatorJson, chunks.headingPathJson,
          chunks.evidenceKind, versions.sourceId, sources.userId,
          sources.placement, sources.placementRef,
          row_number() OVER (
            PARTITION BY versions.sourceId ORDER BY chunks.ordinal, chunks.id
          ) AS sourceRank
        FROM content_chunks AS chunks
        JOIN content_versions AS versions ON versions.id = chunks.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE ${authorization}
          AND sources.id IN (${sourceIds.map(() => "?").join(", ")})
      )
      SELECT * FROM ranked WHERE sourceRank <= 2
      ORDER BY sourceId, sourceRank, chunkId LIMIT ?`,
    args: [...args, Math.min(100, input.limit)],
  });
  const hydrated = await new RoutedCorpusContentReader(client).hydrate(
    rows.rows as unknown as AuthorizedCorpusChunkRow[],
  );
  return rows.rows.flatMap<LexicalCandidate>((row) => {
    const body = hydrated.get(String(row.chunkId));
    if (!body) return [];
    return [
      lexicalCandidateSchema.parse({
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
    ];
  });
}

async function projectRetrievalPolicy(
  client: SqlClient,
  input: OwnedLexicalQuery,
) {
  const placementArgs: InValue[] = [input.ownerId];
  const placementClauses = [
    "sources.userId = ?",
    "sources.placement != 'core'",
    "sources.currentVersionId IS NOT NULL",
  ];
  const addPlacementFilter = (column: string, values: readonly string[]) => {
    if (values.length === 0) return;
    placementClauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
    placementArgs.push(...values);
  };
  addPlacementFilter("sources.yearId", input.yearIds);
  addPlacementFilter("sources.subjectId", input.subjectIds);
  addPlacementFilter("sources.originKind", input.originKinds);
  if ((input.versionIds?.length ?? 0) > 0) {
    placementClauses.push(`EXISTS (
      SELECT 1 FROM content_versions AS placement_versions
      WHERE placement_versions.sourceId = sources.id
        AND placement_versions.id IN (${input.versionIds!.map(() => "?").join(", ")})
    )`);
    placementArgs.push(...input.versionIds!);
  }
  const placementScope = sourceOrProjectScopeSql({
    ...input,
    args: placementArgs,
    sourceSql: (placeholders) => `sources.id IN (${placeholders})`,
    projectSql: (contextModeSql) => ({
      sql: `EXISTS (
        SELECT 1 FROM study_project_items AS placement_items
        JOIN study_projects AS placement_projects
          ON placement_projects.id = placement_items.projectId
        WHERE placement_projects.userId = ?
          AND placement_projects.deletedAt IS NULL
          AND placement_items.kind = sources.originKind
          AND placement_items.referenceId = sources.originId
          AND ${contextModeSql.replaceAll("project_items", "placement_items")}
          AND placement_items.selectorReviewRequired = 0
          AND placement_items.projectId IN (${input.projectIds.map(() => "?").join(", ")})
      )`,
      args: [input.ownerId, ...input.projectIds],
    }),
  });
  if (placementScope) placementClauses.push(placementScope);
  const unsupportedPlacement = await client.execute({
    sql: `SELECT 1 FROM content_sources AS sources
      WHERE ${placementClauses.join(" AND ")} LIMIT 1`,
    args: placementArgs,
  });
  const placementCompatible = unsupportedPlacement.rows.length === 0;

  if (input.projectIds.length === 0) {
    return {
      advanced: placementCompatible,
      advancedRequested: true,
      denseCompatible: placementCompatible,
      fallback: input.fallbackPolicy ?? ("lexical-only" as const),
      embeddingSpaceId: null,
      rerankSpaceId: null,
      unavailableStage: placementCompatible ? null : ("dense" as const),
      unavailableReason: placementCompatible
        ? null
        : "dense-source-placement-incompatible",
    };
  }
  const ids = [...new Set(input.projectIds)];
  const rows = await client.execute({
    sql: `SELECT projects.id, projects.retrievalMode,
        projects.retrievalFallbackPolicy, projects.embeddingSpaceId,
        projects.rerankSpaceId
      FROM study_projects AS projects
      WHERE projects.userId = ? AND projects.deletedAt IS NULL
        AND projects.id IN (${ids.map(() => "?").join(", ")})`,
    args: [input.ownerId, ...ids],
  });
  const advancedRows = rows.rows.filter(
    (row) => row.retrievalMode === "advanced-auto",
  );
  const embeddingSpaceIds = new Set(
    advancedRows.flatMap((row) =>
      row.embeddingSpaceId === null ? [] : [String(row.embeddingSpaceId)],
    ),
  );
  const rerankSpaceIds = new Set(
    advancedRows.flatMap((row) =>
      row.rerankSpaceId === null ? [] : [String(row.rerankSpaceId)],
    ),
  );
  const allProjectsResolved = rows.rows.length === ids.length;
  const allAdvanced =
    allProjectsResolved && advancedRows.length === rows.rows.length;
  const denseCompatible =
    allAdvanced && placementCompatible && embeddingSpaceIds.size === 1;
  const advanced = denseCompatible && rerankSpaceIds.size === 1;
  const policies = advancedRows.map((row) =>
    String(row.retrievalFallbackPolicy),
  );
  // A fail-closed advanced project is authoritative for the whole union. In
  // particular, a lexical-only project must not silently downgrade it merely
  // because both projects happen to be searched together.
  const failClosed = policies.includes("fail");
  const configuredFallback: RetrievalFallbackPolicy = policies.includes(
    "lexical-only",
  )
    ? "lexical-only"
    : policies.includes("hybrid-without-rerank")
      ? "hybrid-without-rerank"
      : "lexical-only";
  const fallback: RetrievalFallbackPolicy = failClosed
    ? "fail"
    : allAdvanced && input.fallbackPolicy
      ? input.fallbackPolicy
      : configuredFallback;
  const unavailableStage = !denseCompatible
    ? ("dense" as const)
    : !advanced
      ? ("rerank" as const)
      : null;
  const unavailableReason = !allProjectsResolved
    ? "retrieval-project-scope-incomplete"
    : !allAdvanced
      ? "dense-mixed-project-policies"
      : !placementCompatible
        ? "dense-source-placement-incompatible"
        : embeddingSpaceIds.size !== 1
          ? "dense-project-space-not-configured"
          : rerankSpaceIds.size !== 1
            ? "rerank-project-space-not-configured"
            : null;
  return {
    advanced,
    advancedRequested: advancedRows.length > 0,
    denseCompatible,
    fallback,
    embeddingSpaceId: [...embeddingSpaceIds][0] ?? null,
    rerankSpaceId: [...rerankSpaceIds][0] ?? null,
    unavailableStage,
    unavailableReason,
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
  const ids = [...new Set(candidates.map((entry) => entry.chunkId))].slice(
    0,
    800,
  );
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
      minimum: Math.max(
        0,
        Math.min(current?.minimum ?? Infinity, winner.ordinal - 1),
      ),
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
    return [
      {
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
      },
    ];
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
  /** Fully hydrated, authorization-fenced and budget-packed evidence. */
  candidates: readonly PolicyCandidate[];
  vectorUsed: boolean;
  vectorImplementation: string | null;
  rerankUsed: boolean;
  rerankImplementation: string | null;
  retrievalMode: "lexical" | "hybrid" | "reranked";
  fallbackReason: string | null;
  operationId: string;
  stages: readonly RetrievalStageTrace[];
};

export type HybridCorpusSearchOptions = {
  client?: SqlClient;
  lexical?: Pick<LexicalSearchBackend, "search">;
  runtime?: CorpusVectorRuntime | null;
  reranker?: RerankProvider | null;
  signal?: AbortSignal;
  /**
   * Project settings govern the advanced pipeline independently of the
   * authorization union formed by eligible project items and direct sources.
   * This policy selector can never add a source to that resolved input scope.
   */
  policyProjectIds?: readonly string[];
  /** Test/paired-node runtimes can provide their already selected generation. */
  corpusGenerationId?: string | null;
  persistTrace?: boolean;
};

export async function hybridCorpusSearch(
  input: OwnedLexicalQuery,
  options: HybridCorpusSearchOptions = {},
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
  const scopeDigest = retrievalScopeDigest({
    ...input,
    policyProjectIds: options.policyProjectIds,
  });
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
    advancedRequested,
    denseCompatible,
    fallback: fallbackPolicy,
    embeddingSpaceId,
    rerankSpaceId,
    unavailableStage,
    unavailableReason,
  } = await projectRetrievalPolicy(client, {
    ...input,
    projectIds: [...(options.policyProjectIds ?? input.projectIds)],
  });
  const policyProjectCount =
    options.policyProjectIds?.length ?? input.projectIds.length;
  stage(
    "scope",
    null,
    policyProjectCount,
    policyProjectCount,
    scopeStarted,
    "used",
  );

  const lexicalStarted = Date.now();
  const lexicalSearch = await lexicalQuestionSearch(lexical, {
    ...input,
    limit: Math.min(LEXICAL_POOL, Math.max(input.limit, LEXICAL_POOL)),
  });
  let lexicalCandidates = lexicalSearch.candidates;
  let lexicalFallbackReason: string | null = null;
  if ((input.sourceIds?.length ?? 0) > 0) {
    const overview = await explicitSourceOverview(client, input);
    const seen = new Set(
      lexicalCandidates.map((candidate) => candidate.chunkId),
    );
    lexicalCandidates = prioritizeExplicitSources(
      [
        ...lexicalCandidates,
        ...overview.filter((candidate) => !seen.has(candidate.chunkId)),
      ],
      input.sourceIds,
    );
    if (lexicalSearch.candidates.length === 0 && overview.length > 0) {
      lexicalFallbackReason = "lexical:explicit-source-overview";
    }
  }
  stage(
    "lexical",
    "sqlite-fts5-unicode61-v1",
    lexicalSearch.queryCount,
    lexicalCandidates.length,
    lexicalStarted,
    lexicalFallbackReason ? "degraded" : "used",
    lexicalFallbackReason,
  );

  const lexicalOnly = async (reason: string | null = null) => {
    fallbackReason = reason ?? lexicalFallbackReason;
    const diversityStarted = Date.now();
    const selected = diversifyRetrievalCandidates(
      deduplicateRetrievalCandidates(policyFromLexical(lexicalCandidates)),
      {
        limit: Math.min(RERANK_WINDOW, Math.max(input.limit, input.limit * 2)),
        prioritySourceIds: input.sourceIds,
      },
    );
    stage(
      "diversity",
      (input.sourceIds?.length ?? 0) > 0
        ? "round-robin-source-locator-explicit-first-v2"
        : "round-robin-source-locator-v1",
      lexicalCandidates.length,
      selected.length,
      diversityStarted,
      "used",
    );
    const bodies = await hydrateAuthorizedBodies(client, input, selected);
    const expansionStarted = Date.now();
    const neighbors = await authorizedNeighborUniverse(
      client,
      input,
      bodies.slice(0, input.limit),
    );
    const expanded = expandParentAndNeighbors(bodies.slice(0, input.limit), [
      ...bodies,
      ...neighbors,
    ]);
    stage(
      "expansion",
      "parent-neighbor-radius-1-v1",
      bodies.length,
      expanded.length,
      expansionStarted,
      "used",
    );
    const packingStarted = Date.now();
    const packed = packRetrievalContext(expanded, {
      maximumTokens: 12_000,
      maximumUtf8Bytes: 64 * 1024,
      maximumVisualItems: 8,
      maximumEvidenceItems: input.limit,
    });
    stage(
      "packing",
      (input.sourceIds?.length ?? 0) > 0
        ? "evidence-budget-explicit-first-v2"
        : "evidence-budget-v1",
      expanded.length,
      packed.packed.length,
      packingStarted,
      "used",
    );
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

  // Exact/phrase/prefix/cursor behavior remains intentionally lexical. A
  // lexical-only project also stays lexical without treating that explicit
  // choice as an advanced-pipeline failure.
  if (
    input.mode !== "terms" ||
    input.cursor ||
    (!advanced && !advancedRequested)
  ) {
    stage("dense", null, 0, 0, Date.now(), "skipped", "lexical-policy");
    stage("fusion", null, 0, 0, Date.now(), "skipped", "lexical-policy");
    stage("rerank", null, 0, 0, Date.now(), "skipped", "lexical-policy");
    return lexicalOnly(null);
  }

  if (!advanced && fallbackPolicy === "fail") {
    const failedStage = unavailableStage ?? "dense";
    if (failedStage === "dense") {
      stage(
        "dense",
        embeddingSpaceId,
        0,
        0,
        Date.now(),
        "failed",
        unavailableReason ?? "advanced-policy-unavailable",
      );
      stage("fusion", null, 0, 0, Date.now(), "skipped", "dense-unavailable");
      stage("rerank", null, 0, 0, Date.now(), "skipped", "dense-unavailable");
    } else {
      stage(
        "dense",
        embeddingSpaceId,
        0,
        0,
        Date.now(),
        "skipped",
        "policy-fail-closed",
      );
      stage("fusion", null, 0, 0, Date.now(), "skipped", "policy-fail-closed");
      stage(
        "rerank",
        rerankSpaceId,
        0,
        0,
        Date.now(),
        "failed",
        unavailableReason ?? "advanced-policy-unavailable",
      );
    }
    fallbackReason = `policy:${unavailableReason ?? "advanced-unavailable"}`;
    await trace();
    throw new Error(
      failedStage === "rerank"
        ? "RETRIEVAL_RERANK_FAILED"
        : "RETRIEVAL_DENSE_FAILED",
    );
  }

  const denseFallback =
    !advanced && fallbackPolicy === "hybrid-without-rerank" && denseCompatible;
  if (!advanced && !denseFallback) {
    stage(
      "dense",
      embeddingSpaceId,
      0,
      0,
      Date.now(),
      "skipped",
      unavailableReason ?? "lexical-policy",
    );
    stage("fusion", null, 0, 0, Date.now(), "skipped", "dense-unavailable");
    stage("rerank", null, 0, 0, Date.now(), "skipped", "dense-unavailable");
    return lexicalOnly(`policy:${unavailableReason ?? "advanced-unavailable"}`);
  }

  let runtime: CorpusVectorRuntime | null = null;
  let queryPublicationFence: EmbeddingPublicationFence | null = null;
  let vectorImplementation: string | null = null;
  let denseCandidates: LexicalCandidate[] = [];
  const denseStarted = Date.now();
  try {
    if (options.runtime === undefined) {
      queryPublicationFence = await readEmbeddingPublicationFence(
        input.ownerId,
      );
      await assertEmbeddingPublicationFence(
        input.ownerId,
        queryPublicationFence.publicationEpoch,
      );
    }
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
    if (!corpusGenerationId) {
      corpusGenerationId = await activeGenerationId(
        client,
        input.ownerId,
        runtime.embedding.descriptor().id,
      );
    }
    if (!corpusGenerationId) throw new Error("dense-generation-unavailable");
    const generationVector = runtime.vector.forGeneration(
      input.ownerId,
      corpusGenerationId,
    );
    const capabilities = await generationVector.capabilities();
    vectorImplementation = capabilities.implementation;
    if (!capabilities.available) throw new Error("dense-index-unavailable");
    const authorizeEmbedding = async () => {
      if (queryPublicationFence) {
        await assertEmbeddingPublicationFence(
          input.ownerId,
          queryPublicationFence.publicationEpoch,
        );
      }
      await runtime?.authorizeEmbedding?.();
    };
    await authorizeEmbedding();
    const context = runtime.consent
      ? {
          operationId,
          signal,
          consent: runtime.consent,
          authorize: authorizeEmbedding,
        }
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
    // A clear/revoke may linearize while the provider request is in flight.
    // Re-authorize before the now-stale vector can be used for a read.
    await authorizeEmbedding();
    if (!queryVector) throw new Error("dense-query-vector-missing");
    const raw = await generationVector.search({
      ownerId: input.ownerId,
      spaceId: runtime.embedding.descriptor().id,
      values: queryVector.values,
      limit: DENSE_POOL,
    });
    const hydratedDenseCandidates = await hydrateOwnedVectorCandidates(
      raw,
      input,
      client,
    );
    // Search and hydration can also overlap a clear/revoke. Do not admit any
    // dense evidence unless the same fence epoch and consent are still live.
    await authorizeEmbedding();
    denseCandidates = hydratedDenseCandidates;
    stage(
      "dense",
      runtime.embedding.descriptor().id,
      1,
      denseCandidates.length,
      denseStarted,
      "used",
    );
  } catch (error) {
    signal.throwIfAborted();
    const reason =
      error instanceof Error ? error.message.slice(0, 200) : "dense-failed";
    stage(
      "dense",
      runtime?.embedding.descriptor().id ?? null,
      1,
      0,
      denseStarted,
      fallbackPolicy === "fail" ? "failed" : "degraded",
      reason,
    );
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
  const lexicalById = new Map(
    lexicalCandidates.map((entry) => [entry.chunkId, entry]),
  );
  const denseById = new Map(
    denseCandidates.map((entry) => [entry.chunkId, entry]),
  );
  const fusedCandidates = fused.flatMap<PolicyCandidate>((ranked) => {
    const candidate =
      lexicalById.get(ranked.chunkId) ?? denseById.get(ranked.chunkId);
    if (!candidate) return [];
    return [
      {
        ...candidate,
        channels: ranked.channels.map((channel) =>
          channel === "vector" ? ("dense" as const) : ("lexical" as const),
        ),
        fusedScore: ranked.score,
      },
    ];
  });
  const deduplicated = deduplicateRetrievalCandidates(fusedCandidates);
  stage(
    "fusion",
    "weighted-rrf-k60-v1",
    lexicalCandidates.length + denseCandidates.length,
    deduplicated.length,
    fusionStarted,
    "used",
  );

  const diversityStarted = Date.now();
  let selected = diversifyRetrievalCandidates(deduplicated, {
    limit: RERANK_WINDOW,
    maximumPerSource: 4,
    maximumPerLocator: 2,
    prioritySourceIds: input.sourceIds,
  });
  stage(
    "diversity",
    (input.sourceIds?.length ?? 0) > 0
      ? "round-robin-source-locator-explicit-first-v2"
      : "round-robin-source-locator-v1",
    deduplicated.length,
    selected.length,
    diversityStarted,
    "used",
  );
  selected = await hydrateAuthorizedBodies(client, input, selected);

  let rerankUsed = false;
  let rerankImplementation: string | null = null;
  const rerankStarted = Date.now();
  if (denseFallback) {
    fallbackReason = `rerank:${unavailableReason ?? "rerank-unavailable"}`;
    stage(
      "rerank",
      rerankSpaceId,
      selected.length,
      selected.length,
      rerankStarted,
      "degraded",
      unavailableReason ?? "rerank-unavailable",
    );
  } else {
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
        // Keep the whole bounded window so an explicit attachment cannot be
        // discarded before the deterministic scope-priority tier is applied.
        topN: selected.length,
        signal,
      });
      rerankUsed = true;
      stage(
        "rerank",
        rerankImplementation,
        deduplicated.length,
        selected.length,
        rerankStarted,
        "used",
      );
    } catch (error) {
      signal.throwIfAborted();
      const reason =
        error instanceof Error ? error.message.slice(0, 200) : "rerank-failed";
      stage(
        "rerank",
        rerankImplementation,
        selected.length,
        0,
        rerankStarted,
        fallbackPolicy === "fail" ? "failed" : "degraded",
        reason,
      );
      fallbackReason = `rerank:${reason}`;
      if (fallbackPolicy === "fail") {
        await trace();
        throw new Error("RETRIEVAL_RERANK_FAILED");
      }
      if (fallbackPolicy === "lexical-only") {
        const lexicalSelected = diversifyRetrievalCandidates(
          deduplicateRetrievalCandidates(policyFromLexical(lexicalCandidates)),
          {
            limit: Math.min(
              RERANK_WINDOW,
              Math.max(input.limit, input.limit * 2),
            ),
            prioritySourceIds: input.sourceIds,
          },
        );
        selected = await hydrateAuthorizedBodies(
          client,
          input,
          lexicalSelected,
        );
      }
    }
  }

  const winners = prioritizeExplicitSources(selected, input.sourceIds).slice(
    0,
    input.limit,
  );
  const expansionStarted = Date.now();
  const neighbors = await authorizedNeighborUniverse(client, input, winners);
  const expanded = expandParentAndNeighbors(winners, [
    ...selected,
    ...neighbors,
  ]);
  stage(
    "expansion",
    "parent-neighbor-radius-1-v1",
    winners.length,
    expanded.length,
    expansionStarted,
    "used",
  );
  const packingStarted = Date.now();
  const packed = packRetrievalContext(expanded, {
    maximumTokens: 12_000,
    maximumUtf8Bytes: 64 * 1024,
    maximumVisualItems: 8,
    maximumEvidenceItems: input.limit,
  });
  stage(
    "packing",
    (input.sourceIds?.length ?? 0) > 0
      ? "evidence-budget-explicit-first-v2"
      : "evidence-budget-v1",
    expanded.length,
    packed.packed.length,
    packingStarted,
    "used",
  );
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
