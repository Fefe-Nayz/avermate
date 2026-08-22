import type { Client, InValue } from "@libsql/client";
import {
  lexicalCandidateSchema,
  sourceLocatorV1Schema,
  type LexicalCandidate,
  type OwnedLexicalQuery,
  type VectorCandidate,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { SqliteFts5LexicalSearchBackend } from "./lexical";
import { reciprocalRankFusion } from "./vector";
import {
  createConfiguredCorpusVectorRuntime,
  type CorpusVectorRuntime,
} from "./vector-runtime";
import { jsonValue, sha256 } from "./values";

type SqlClient = Pick<Client, "execute" | "transaction">;

function vectorSnippet(text: string) {
  const bounded = text.trim().slice(0, 520);
  return `${bounded}${text.trim().length > bounded.length ? "…" : ""}`;
}

async function projectScope(
  client: SqlClient,
  input: OwnedLexicalQuery,
): Promise<Set<string> | null> {
  if (input.projectIds.length === 0) return null;
  const rows = await client.execute({
    sql: `
      SELECT items.kind, items.referenceId
      FROM study_project_items AS items
      JOIN study_projects AS projects ON projects.id = items.projectId
      WHERE projects.userId = ? AND projects.deletedAt IS NULL
        AND items.contextMode != 'exclude'
        AND items.projectId IN (${input.projectIds.map(() => "?").join(", ")})
    `,
    args: [input.ownerId, ...input.projectIds],
  });
  return new Set(
    rows.rows.map((row) => `${String(row.kind)}:${String(row.referenceId)}`),
  );
}

/**
 * Hydrate vector IDs only through current, owned core rows. Qdrant already
 * filters ownership before returning candidates; this second fence prevents a
 * stale or corrupted payload from ever selecting another user's body.
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
  const scopedProjects = await projectScope(client, input);
  const args: InValue[] = [input.ownerId, ...ids];
  const rows = await client.execute({
    sql: `
      SELECT chunks.id AS chunkId, chunks.versionId, chunks.ordinal,
        chunks.text, chunks.contentHash, chunks.locatorJson,
        chunks.evidenceKind, versions.sourceId, sources.yearId,
        sources.subjectId, sources.originKind, sources.originId
      FROM content_chunks AS chunks
      JOIN content_versions AS versions ON versions.id = chunks.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      WHERE sources.userId = ?
        AND sources.currentVersionId = versions.id
        AND chunks.id IN (${ids.map(() => "?").join(", ")})
    `,
    args,
  });
  const score = new Map(
    candidates.map((entry) => [entry.chunkId, entry.score]),
  );
  const allowed = rows.rows.filter((row) => {
    const yearId = row.yearId === null ? null : String(row.yearId);
    const subjectId = row.subjectId === null ? null : String(row.subjectId);
    const originKind = String(row.originKind);
    if (
      input.yearIds.length > 0 &&
      (!yearId || !input.yearIds.includes(yearId))
    ) {
      return false;
    }
    if (
      input.subjectIds.length > 0 &&
      (!subjectId || !input.subjectIds.includes(subjectId))
    ) {
      return false;
    }
    if (
      input.originKinds.length > 0 &&
      !input.originKinds.includes(originKind as never)
    ) {
      return false;
    }
    return (
      !scopedProjects ||
      scopedProjects.has(`${originKind}:${String(row.originId)}`)
    );
  });
  const hydrated = allowed.map((row) =>
    lexicalCandidateSchema.parse({
      sourceId: String(row.sourceId),
      versionId: String(row.versionId),
      chunkId: String(row.chunkId),
      ordinal: Number(row.ordinal),
      score: score.get(String(row.chunkId)) ?? 0,
      snippet: vectorSnippet(String(row.text)),
      locator: sourceLocatorV1Schema.parse(jsonValue(row.locatorJson)),
      contentHash: String(row.contentHash),
      evidenceKind: row.evidenceKind,
    }),
  );
  return hydrated.sort(
    (left, right) =>
      right.score - left.score || left.chunkId.localeCompare(right.chunkId),
  );
}

export type HybridSearchResult = {
  candidates: readonly LexicalCandidate[];
  vectorUsed: boolean;
  vectorImplementation: string | null;
};

export async function hybridCorpusSearch(
  input: OwnedLexicalQuery,
  options: {
    client?: SqlClient;
    lexical?: SqliteFts5LexicalSearchBackend;
    runtime?: CorpusVectorRuntime | null;
  } = {},
): Promise<HybridSearchResult> {
  const client = options.client ?? db.$client;
  const lexical = options.lexical ?? new SqliteFts5LexicalSearchBackend(client);
  const candidateInput = {
    ...input,
    limit: Math.min(50, Math.max(input.limit, input.limit * 4)),
  };
  const lexicalCandidates = await lexical.search(candidateInput);
  // Exact/phrase/prefix semantics and paginated offsets remain strictly lexical.
  if (input.mode !== "terms" || input.cursor) {
    return {
      candidates: lexicalCandidates.slice(0, input.limit),
      vectorUsed: false,
      vectorImplementation: null,
    };
  }
  let runtime: CorpusVectorRuntime | null;
  try {
    runtime =
      options.runtime === undefined
        ? createConfiguredCorpusVectorRuntime()
        : options.runtime;
  } catch {
    runtime = null;
  }
  if (!runtime) {
    return {
      candidates: lexicalCandidates.slice(0, input.limit),
      vectorUsed: false,
      vectorImplementation: null,
    };
  }
  const capabilities = await runtime.vector.capabilities();
  if (!capabilities.available) {
    return {
      candidates: lexicalCandidates.slice(0, input.limit),
      vectorUsed: false,
      vectorImplementation: capabilities.implementation,
    };
  }
  const [queryVector] = await runtime.embedding.embedText([
    { contentHash: sha256(input.query), text: input.query },
  ]);
  if (!queryVector)
    throw new Error("Embedding provider omitted the search query");
  const rawVector = await runtime.vector.search({
    ownerId: input.ownerId,
    spaceId: runtime.embedding.descriptor().id,
    values: queryVector.values,
    limit: Math.min(800, Math.max(input.limit * 8, input.limit)),
  });
  const vectorCandidates = await hydrateOwnedVectorCandidates(
    rawVector,
    input,
    client,
  );
  const fused = reciprocalRankFusion({
    lexical: lexicalCandidates,
    vector: vectorCandidates,
  });
  const lexicalById = new Map(
    lexicalCandidates.map((entry) => [entry.chunkId, entry]),
  );
  const vectorById = new Map(
    vectorCandidates.map((entry) => [entry.chunkId, entry]),
  );
  const candidates = fused.slice(0, input.limit).flatMap((ranked) => {
    const candidate =
      lexicalById.get(ranked.chunkId) ?? vectorById.get(ranked.chunkId);
    return candidate ? [{ ...candidate, score: ranked.score }] : [];
  });
  return {
    candidates,
    vectorUsed: true,
    vectorImplementation: capabilities.implementation,
  };
}
