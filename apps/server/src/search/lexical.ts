import type { Client, InStatement, InValue, Transaction } from "@libsql/client";
import {
  lexicalCandidateSchema,
  ownedLexicalQuerySchema,
  sourceLocatorV1Schema,
  type LexicalCandidate,
  type LexicalConsistencyReport,
  type LexicalSearchBackend,
  type LexicalSearchCapabilities,
  type LexicalVersionInput,
  type OwnedLexicalQuery,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { sourceOrProjectScopeSql } from "./context-access";
import { jsonValue, normalizeForSearch } from "./values";

type SqlClient = Pick<Client, "execute" | "transaction">;

const MODES = ["terms", "phrase", "prefix", "exact"] as const;
const MAX_CANDIDATE_MULTIPLIER = 8;

function terms(value: string) {
  return normalizeForSearch(value)
    .match(/[\p{L}\p{N}_]+/gu)
    ?.filter(Boolean)
    .slice(0, 64);
}

function quoteFts(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function safeFtsQuery(
  query: string,
  mode: Exclude<OwnedLexicalQuery["mode"], "exact">,
) {
  const tokens = terms(query) ?? [];
  if (tokens.length === 0) return null;
  if (mode === "phrase") return quoteFts(tokens.join(" "));
  if (mode === "prefix") {
    return tokens.map((token) => `${quoteFts(token)}*`).join(" AND ");
  }
  return tokens.map(quoteFts).join(" AND ");
}

function decodeOffset(cursor: string | null) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      offset?: unknown;
    };
    return typeof parsed.offset === "number" &&
      Number.isSafeInteger(parsed.offset) &&
      parsed.offset >= 0 &&
      parsed.offset <= 1_000_000
      ? parsed.offset
      : 0;
  } catch {
    return 0;
  }
}

export function lexicalCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

function filterSql(input: OwnedLexicalQuery, args: InValue[]) {
  const clauses: string[] = [];
  const list = (column: string, values: readonly string[]) => {
    if (values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
    args.push(...values);
  };
  list("sources.yearId", input.yearIds);
  list("sources.subjectId", input.subjectIds);
  list("sources.originKind", input.originKinds);
  list("versions.id", input.versionIds ?? []);
  const scopedSources = sourceOrProjectScopeSql({
    ...input,
    args,
    sourceSql: (placeholders) =>
      (input.versionIds?.length ?? 0) > 0
        ? `sources.id IN (${placeholders})`
        : `(sources.id IN (${placeholders}) AND sources.currentVersionId = versions.id)`,
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
  if (scopedSources) clauses.push(scopedSources);
  else clauses.push("sources.currentVersionId = versions.id");
  return clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
}

function snippet(text: string, query: string) {
  const bounded = text.slice(0, 16_384);
  const normalized = bounded
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("fr");
  const needle =
    terms(query)?.[0]
      ?.normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase("fr") ?? "";
  const match = needle ? normalized.indexOf(needle) : -1;
  const start = Math.max(0, (match < 0 ? 0 : match) - 120);
  const end = Math.min(bounded.length, start + 520);
  return `${start > 0 ? "…" : ""}${bounded.slice(start, end)}${end < bounded.length ? "…" : ""}`;
}

async function execute(
  client: SqlClient | Transaction,
  statement: InStatement,
) {
  return client.execute(statement);
}

export class SqliteFts5LexicalSearchBackend implements LexicalSearchBackend {
  constructor(private readonly client: SqlClient = db.$client) {}

  async capabilities(): Promise<LexicalSearchCapabilities> {
    try {
      await this.client.execute(
        "SELECT count(*) AS count FROM content_chunks_fts LIMIT 1",
      );
      return {
        available: true,
        implementation: "sqlite-fts5-unicode61-v1",
        modes: MODES,
      };
    } catch {
      return {
        available: false,
        implementation: "sqlite-fts5-unavailable",
        modes: [],
      };
    }
  }

  async upsertVersion(input: LexicalVersionInput): Promise<void> {
    if (
      input.ownerId !== input.source.ownerId ||
      input.version.sourceId !== input.source.id
    ) {
      throw new Error("The lexical version is not owned by this source");
    }
    const transaction = await this.client.transaction("write");
    try {
      const placement = await execute(transaction, {
        sql: `SELECT placement FROM content_sources
          WHERE id = ? AND userId = ? LIMIT 1`,
        args: [input.source.id, input.ownerId],
      });
      const source = placement.rows[0];
      if (!source) {
        throw new Error("The lexical source was not found");
      }
      await execute(transaction, {
        sql: `DELETE FROM content_chunks_fts WHERE versionId = ?`,
        args: [input.version.id],
      });
      // A Node-owned corpus must never leave searchable plaintext in the
      // Core FTS table. Treat a misplaced upsert as an idempotent purge.
      if (source.placement !== "core") {
        await transaction.commit();
        return;
      }
      const stored = await execute(transaction, {
        sql: `
          SELECT chunks.id, chunks.ordinal
          FROM content_chunks AS chunks
          JOIN content_versions AS versions ON versions.id = chunks.versionId
          JOIN content_sources AS sources ON sources.id = versions.sourceId
          WHERE chunks.versionId = ? AND sources.userId = ?
          ORDER BY chunks.ordinal
        `,
        args: [input.version.id, input.ownerId],
      });
      if (stored.rows.length !== input.chunks.length) {
        throw new Error("Lexical input does not match the committed chunk set");
      }
      for (let index = 0; index < stored.rows.length; index += 1) {
        const row = stored.rows[index]!;
        const chunk = input.chunks[index]!;
        if (Number(row.ordinal) !== chunk.ordinal) {
          throw new Error("Lexical chunk ordinals do not match storage");
        }
        await execute(transaction, {
          sql: `
            INSERT INTO content_chunks_fts (
              chunkId, versionId, sourceId, ownerId, text, normalizedText
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          args: [
            row.id,
            input.version.id,
            input.source.id,
            input.ownerId,
            chunk.text,
            chunk.normalizedText,
          ],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async removeVersion(versionId: string): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM content_chunks_fts WHERE versionId = ?`,
      args: [versionId],
    });
  }

  async search(rawInput: OwnedLexicalQuery): Promise<LexicalCandidate[]> {
    const input = ownedLexicalQuerySchema.parse(rawInput);
    if (!(await this.capabilities()).available) return [];
    const offset = decodeOffset(input.cursor);
    const args: InValue[] = [];
    let predicate: string;
    let score: string;
    if (input.mode === "exact") {
      predicate = `instr(chunks.text, ?) > 0`;
      args.push(input.query);
      score = `1.0 + (1.0 / (1 + chunks.ordinal))`;
    } else {
      const fts = safeFtsQuery(input.query, input.mode);
      if (!fts) return [];
      predicate = `content_chunks_fts MATCH ?`;
      args.push(fts);
      score = `-bm25(content_chunks_fts)`;
    }
    args.push(input.ownerId);
    const filters = filterSql(input, args);
    const candidateLimit = Math.min(
      800,
      Math.max(input.limit, input.limit * MAX_CANDIDATE_MULTIPLIER),
    );
    args.push(candidateLimit, offset);
    const from =
      input.mode === "exact"
        ? "content_chunks AS chunks"
        : "content_chunks_fts JOIN content_chunks AS chunks ON chunks.id = content_chunks_fts.chunkId";
    const candidates = await this.client.execute({
      sql: `
        SELECT chunks.id AS chunkId, chunks.versionId, chunks.ordinal,
          chunks.contentHash, chunks.locatorJson, chunks.evidenceKind,
          versions.sourceId, ${score} AS score
        FROM ${from}
        JOIN content_versions AS versions ON versions.id = chunks.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE ${predicate}
          AND sources.userId = ?
          AND sources.placement = 'core'
          ${filters}
        ORDER BY score DESC, chunks.id ASC
        LIMIT ? OFFSET ?
      `,
      args,
    });
    if (candidates.rows.length === 0) return [];

    // Deliberately re-check ownership before selecting any body. Candidate ids
    // cannot turn into text merely because they were present in the FTS table.
    const ids = candidates.rows.map((row) => String(row.chunkId));
    const bodyArgs: InValue[] = [input.ownerId];
    const bodyFilters = filterSql(input, bodyArgs);
    bodyArgs.push(...ids);
    const bodies = await this.client.execute({
      sql: `
        SELECT chunks.id, chunks.text
        FROM content_chunks AS chunks
        JOIN content_versions AS versions ON versions.id = chunks.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE sources.userId = ?
          AND sources.placement = 'core'
          ${bodyFilters}
          AND chunks.id IN (${ids.map(() => "?").join(", ")})
      `,
      args: bodyArgs,
    });
    const textById = new Map(
      bodies.rows.map((row) => [String(row.id), String(row.text)]),
    );
    const results: LexicalCandidate[] = [];
    for (const row of candidates.rows) {
      const text = textById.get(String(row.chunkId));
      if (text === undefined) continue;
      results.push(
        lexicalCandidateSchema.parse({
          sourceId: String(row.sourceId),
          versionId: String(row.versionId),
          chunkId: String(row.chunkId),
          ordinal: Number(row.ordinal),
          score: Number(row.score),
          snippet: snippet(text, input.query),
          locator: sourceLocatorV1Schema.parse(jsonValue(row.locatorJson)),
          contentHash: String(row.contentHash),
          evidenceKind: row.evidenceKind,
        }),
      );
      if (results.length >= input.limit) break;
    }
    return results;
  }

  async verify(): Promise<LexicalConsistencyReport> {
    const missing = await this.client.execute(`
      SELECT DISTINCT versions.id
      FROM content_versions AS versions
      JOIN content_chunks AS chunks ON chunks.versionId = versions.id
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      LEFT JOIN content_chunks_fts AS fts ON fts.chunkId = chunks.id
      WHERE sources.placement = 'core' AND fts.chunkId IS NULL
      ORDER BY versions.id
    `);
    const orphaned = await this.client.execute(`
      SELECT DISTINCT fts.versionId AS id
      FROM content_chunks_fts AS fts
      LEFT JOIN content_versions AS versions ON versions.id = fts.versionId
      LEFT JOIN content_sources AS sources ON sources.id = versions.sourceId
      WHERE versions.id IS NULL OR COALESCE(sources.placement, '') != 'core'
      ORDER BY fts.versionId
    `);
    const indexed = await this.client.execute(
      `SELECT count(DISTINCT versionId) AS count FROM content_chunks_fts`,
    );
    const missingVersionIds = missing.rows.map((row) => String(row.id));
    const orphanedVersionIds = orphaned.rows.map((row) => String(row.id));
    return {
      consistent:
        missingVersionIds.length === 0 && orphanedVersionIds.length === 0,
      indexedVersions: Number(indexed.rows[0]?.count ?? 0),
      missingVersionIds,
      orphanedVersionIds,
    };
  }

  async rebuild() {
    const transaction = await this.client.transaction("write");
    try {
      await execute(transaction, `DELETE FROM content_chunks_fts`);
      await execute(
        transaction,
        `
        INSERT INTO content_chunks_fts (
          chunkId, versionId, sourceId, ownerId, text, normalizedText
        )
        SELECT chunks.id, chunks.versionId, versions.sourceId, sources.userId,
          chunks.text, chunks.normalizedText
        FROM content_chunks AS chunks
        JOIN content_versions AS versions ON versions.id = chunks.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE sources.placement = 'core'
        ORDER BY chunks.id
      `,
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return this.verify();
  }
}
