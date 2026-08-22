import type { Client, InValue, Transaction } from "@libsql/client";
import {
  contentSourceRecordSchema,
  contentVersionRecordSchema,
  lexicalCandidateSchema,
  sourceLocatorV1Schema,
  stagedContentChunkSchema,
  type CapabilityPlacement,
  type LexicalCandidate,
  type LexicalSearchBackend,
  type LexicalVersionInput,
  type NodeLexicalSearchTransport,
  type OwnedLexicalQuery,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { db } from "../db";
import { env } from "../lib/env";
import { newId } from "../lib/id";
import { NodeLexicalSearchBackend } from "../node/node-provider-adapters";
import { registerPlacementMigrationAdapter } from "../node/placement-migration-adapters";
import { relayNodeProviderTransport } from "../node/services";
import { CoreCorpusStore } from "./core-corpus-store";
import {
  RoutedCorpusContentReader,
  type AuthorizedCorpusChunkRow,
} from "./corpus-content-reader";
import { SqliteFts5LexicalSearchBackend } from "./lexical";
import {
  isNodeCorpusEnvelope,
  NodeCorpusEnvelopeCodec,
} from "./node-corpus-envelope";
import { canonicalJson, jsonValue } from "./values";

type ExecuteClient = Pick<Client, "execute">;
type SqlClient = Pick<Client, "execute" | "batch" | "transaction">;
type CorpusPlanePlacement =
  | { kind: "core" }
  | { kind: "node"; nodeId: string };

function iso(value: unknown) {
  return new Date(Number(value) * 1_000).toISOString();
}

function digestVersions(versions: readonly LexicalVersionInput[]) {
  const canonical = versions
    .map((entry) => ({
      ownerId: entry.ownerId,
      source: {
        ...entry.source,
        placement: { kind: "core" as const },
        placementRef: null,
      },
      version: entry.version,
      chunks: entry.chunks
        .map((chunk) => ({
          chunkId: chunk.chunkId ?? null,
          ordinal: chunk.ordinal,
          contentHash: chunk.contentHash,
          text: chunk.text,
          normalizedText: chunk.normalizedText,
          tokenEstimate: chunk.tokenEstimate,
          locator: chunk.locator,
          headingPath: chunk.headingPath,
          evidenceKind: chunk.evidenceKind,
        }))
        .sort((left, right) => left.ordinal - right.ordinal),
    }))
    .sort((left, right) => left.version.id.localeCompare(right.version.id));
  return `sha256:${createHash("sha256").update(canonicalJson(canonical)).digest("hex")}`;
}

async function sourceIdsAtPlacement(
  client: SqlClient,
  ownerId: string,
  placement: CapabilityPlacement,
) {
  if (placement.kind !== "core" && placement.kind !== "node") return [];
  const result = await client.execute({
    sql:
      placement.kind === "node"
        ? `SELECT id FROM content_sources WHERE userId = ?
             AND placement = 'node' AND placementRef = ? ORDER BY id`
        : `SELECT id FROM content_sources WHERE userId = ?
             AND placement = 'core' ORDER BY id`,
    args:
      placement.kind === "node"
        ? [ownerId, placement.nodeId]
        : [ownerId],
  });
  return result.rows.map((row) => String(row.id));
}

async function loadCoreVersions(
  client: ExecuteClient,
  ownerId: string,
  sourceIds: readonly string[],
  codec: NodeCorpusEnvelopeCodec,
) {
  const versions: LexicalVersionInput[] = [];
  for (const sourceId of sourceIds) {
    const sourceResult = await client.execute({
      sql: `SELECT * FROM content_sources WHERE id = ? AND userId = ? LIMIT 1`,
      args: [sourceId, ownerId],
    });
    const sourceRow = sourceResult.rows[0];
    if (!sourceRow) throw new Error("RETRIEVAL_MIGRATION_SOURCE_MISSING");
    const source = contentSourceRecordSchema.parse({
      id: String(sourceRow.id),
      ownerId: String(sourceRow.userId),
      originKind: sourceRow.originKind,
      originId: String(sourceRow.originId),
      yearId: sourceRow.yearId === null ? null : String(sourceRow.yearId),
      subjectId:
        sourceRow.subjectId === null ? null : String(sourceRow.subjectId),
      currentVersionId:
        sourceRow.currentVersionId === null
          ? null
          : String(sourceRow.currentVersionId),
      status: sourceRow.status,
      coverage: sourceRow.coverage,
      placement:
        sourceRow.placement === "node"
          ? { kind: "node", nodeId: String(sourceRow.placementRef) }
          : { kind: "core" },
      placementRef:
        sourceRow.placementRef === null
          ? null
          : String(sourceRow.placementRef),
      createdAt: iso(sourceRow.createdAt),
      updatedAt: iso(sourceRow.updatedAt),
    });
    const versionRows = await client.execute({
      sql: `SELECT * FROM content_versions WHERE sourceId = ? ORDER BY id`,
      args: [sourceId],
    });
    for (const versionRow of versionRows.rows) {
      const version = contentVersionRecordSchema.parse({
        id: String(versionRow.id),
        sourceId,
        versionKey: String(versionRow.versionKey),
        contentHash: String(versionRow.contentHash),
        extractorId: String(versionRow.extractorId),
        extractorVersion: String(versionRow.extractorVersion),
        mimeType:
          versionRow.mimeType === null ? null : String(versionRow.mimeType),
        language:
          versionRow.language === null ? null : String(versionRow.language),
        byteSize:
          versionRow.byteSize === null ? null : Number(versionRow.byteSize),
        locatorSchemaVersion: 1,
        metadata: jsonValue<Record<string, unknown>>(versionRow.metadataJson),
        createdAt: iso(versionRow.createdAt),
      });
      const chunkRows = await client.execute({
        sql: `SELECT * FROM content_chunks WHERE versionId = ? ORDER BY ordinal`,
        args: [version.id],
      });
      const chunks = chunkRows.rows.map((chunkRow) => {
        const chunkId = String(chunkRow.id);
        const text = String(chunkRow.text);
        const normalizedText = String(chunkRow.normalizedText);
        if (source.placement.kind === "node" && isNodeCorpusEnvelope(text)) {
          return codec.open({
            ownerId,
            nodeId: source.placement.nodeId,
            sourceId,
            versionKey: version.versionKey,
            ordinal: Number(chunkRow.ordinal),
            contentHash: String(chunkRow.contentHash),
            chunkId,
            text,
            normalizedText,
          });
        }
        if (source.placement.kind === "core" && isNodeCorpusEnvelope(text)) {
          throw new Error("CORE_CORPUS_ENVELOPE_PLACEMENT_MISMATCH");
        }
        // Legacy Node rows are accepted only inside migration/reconciliation.
        // User-facing reads never consume this local plaintext path.
        return stagedContentChunkSchema.parse({
          chunkId,
          ordinal: Number(chunkRow.ordinal),
          text,
          normalizedText,
          tokenEstimate: Number(chunkRow.tokenEstimate),
          contentHash: String(chunkRow.contentHash),
          locator: jsonValue(chunkRow.locatorJson),
          headingPath:
            chunkRow.headingPathJson === null
              ? null
              : jsonValue(chunkRow.headingPathJson),
          evidenceKind: chunkRow.evidenceKind,
        });
      });
      versions.push({
        ownerId,
        source,
        version,
        chunks,
      });
    }
  }
  return versions;
}

async function loadLocalIndexedVersions(
  client: ExecuteClient,
  ownerId: string,
  basis: readonly LexicalVersionInput[],
) {
  const versions: LexicalVersionInput[] = [];
  for (const entry of basis) {
    const rows = await client.execute({
      sql: `SELECT fts.chunkId, chunks.ordinal, fts.text, fts.normalizedText,
          chunks.tokenEstimate, chunks.contentHash, chunks.locatorJson,
          chunks.headingPathJson, chunks.evidenceKind
        FROM content_chunks_fts AS fts
        JOIN content_chunks AS chunks ON chunks.id = fts.chunkId
        JOIN content_versions AS versions ON versions.id = chunks.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE fts.versionId = ? AND versions.sourceId = ?
          AND sources.userId = ? AND sources.placement = 'core'
        ORDER BY chunks.ordinal`,
      args: [entry.version.id, entry.source.id, ownerId],
    });
    versions.push({
      ...entry,
      source: {
        ...entry.source,
        placement: { kind: "core" },
        placementRef: null,
      },
      chunks: rows.rows.map((row) =>
        stagedContentChunkSchema.parse({
          chunkId: String(row.chunkId),
          ordinal: Number(row.ordinal),
          text: String(row.text),
          normalizedText: String(row.normalizedText),
          tokenEstimate: Number(row.tokenEstimate),
          contentHash: String(row.contentHash),
          locator: jsonValue(row.locatorJson),
          headingPath:
            row.headingPathJson === null
              ? null
              : jsonValue(row.headingPathJson),
          evidenceKind: row.evidenceKind,
        }),
      ),
    });
  }
  return versions;
}

function samePlacement(
  left: CapabilityPlacement,
  right: CapabilityPlacement,
) {
  return (
    left.kind === right.kind &&
    (left.kind !== "node" ||
      (right.kind === "node" && left.nodeId === right.nodeId))
  );
}

function isCorpusPlanePlacement(
  placement: CapabilityPlacement,
): placement is CapabilityPlacement & CorpusPlanePlacement {
  return placement.kind === "core" || placement.kind === "node";
}

function matchesScopeSql(input: OwnedLexicalQuery, args: InValue[]) {
  const clauses = ["userId = ?"];
  args.push(input.ownerId);
  const add = (column: string, values: readonly string[]) => {
    if (values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(",")})`);
    args.push(...values);
  };
  add("yearId", input.yearIds);
  add("subjectId", input.subjectIds);
  add("originKind", input.originKinds);
  return clauses.join(" AND ");
}

function authorizedCandidateSql(input: OwnedLexicalQuery, args: InValue[]) {
  const clauses = ["sources.userId = ?", "sources.placement = 'node'"];
  args.push(input.ownerId);
  if (input.projectIds.length === 0) {
    clauses.push("sources.currentVersionId = versions.id");
  } else {
    clauses.push(`EXISTS (
      SELECT 1 FROM study_project_items AS project_items
      JOIN study_projects AS projects ON projects.id = project_items.projectId
      WHERE projects.userId = ? AND projects.deletedAt IS NULL
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
        AND project_items.projectId IN (${input.projectIds.map(() => "?").join(",")})
    )`);
    args.push(input.ownerId, ...input.projectIds);
  }
  const add = (column: string, values: readonly string[]) => {
    if (values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(",")})`);
    args.push(...values);
  };
  add("sources.yearId", input.yearIds);
  add("sources.subjectId", input.subjectIds);
  add("sources.originKind", input.originKinds);
  return clauses.join(" AND ");
}

function boundedBodySnippet(text: string) {
  const normalized = text.trim().replaceAll(/\s+/gu, " ");
  return normalized.length > 520
    ? `${normalized.slice(0, 519)}…`
    : normalized;
}

/**
 * Production lexical router. Core keeps authorization/citation metadata and,
 * for Node placement, an authenticated encrypted recovery envelope. Only the
 * selected plane owns readable chunk bodies and a searchable index. A Node
 * outage is explicit and never falls back to Core plaintext or Core FTS.
 */
export class RoutedCorpusStore extends CoreCorpusStore {
  readonly #local: SqliteFts5LexicalSearchBackend;
  readonly #codec: NodeCorpusEnvelopeCodec;

  constructor(
    private readonly routedClient: SqlClient = db.$client,
    private readonly transport: NodeLexicalSearchTransport =
      relayNodeProviderTransport,
    envelopeSecret =
      env.NODE_CREDENTIAL_MASTER_SECRET ?? env.BETTER_AUTH_SECRET,
  ) {
    super(routedClient);
    this.#local = new SqliteFts5LexicalSearchBackend(routedClient);
    this.#codec = new NodeCorpusEnvelopeCodec(envelopeSecret);
  }

  async #node(nodeId: string, ownerId: string) {
    const backend = new NodeLexicalSearchBackend(
      nodeId,
      ownerId,
      this.transport,
    );
    const capabilities = await backend.capabilities();
    if (!capabilities.available) {
      throw new Error("NODE_RETRIEVAL_CAPABILITY_OFFLINE");
    }
    return backend;
  }

  override async stageVersion(
    input: Parameters<CoreCorpusStore["stageVersion"]>[0],
  ) {
    const source = await this.getSource(input.identity);
    if (!source || source.id !== input.sourceId) {
      throw new Error("The staged source identity is not owned");
    }
    if (source.placement.kind !== "node") {
      return super.stageVersion(input);
    }
    const nodeId = source.placement.nodeId;
    return super.stageVersion({
      ...input,
      chunks: input.chunks.map((chunk) =>
        this.#codec.seal({
          ownerId: input.identity.ownerId,
          nodeId,
          sourceId: source.id,
          versionKey: input.versionKey,
          ordinal: chunk.ordinal,
          contentHash: chunk.contentHash,
          chunk,
        }),
      ),
    });
  }

  async search(input: OwnedLexicalQuery): Promise<LexicalCandidate[]> {
    const args: InValue[] = [];
    const rows = await this.routedClient.execute({
      sql: `SELECT DISTINCT placement, placementRef FROM content_sources
        WHERE ${matchesScopeSql(input, args)}`,
      args,
    });
    const candidates: LexicalCandidate[] = [];
    const nodeCandidates: Array<{
      nodeId: string;
      candidate: LexicalCandidate;
    }> = [];
    if (rows.rows.some((row) => row.placement === "core")) {
      candidates.push(...(await this.#local.search(input)));
    }
    for (const nodeId of new Set(
      rows.rows.flatMap((row) =>
        row.placement === "node" && row.placementRef !== null
          ? [String(row.placementRef)]
          : [],
      ),
    )) {
      nodeCandidates.push(
        ...(
          await (await this.#node(nodeId, input.ownerId)).search(input)
        ).map((candidate) => ({ nodeId, candidate })),
      );
    }
    if (nodeCandidates.length > 0) {
      const ids = [
        ...new Set(nodeCandidates.map(({ candidate }) => candidate.chunkId)),
      ];
      const authArgs: InValue[] = [];
      const authorization = authorizedCandidateSql(input, authArgs);
      authArgs.push(...ids);
      const rows = await this.routedClient.execute({
        sql: `SELECT chunks.id AS chunkId, chunks.versionId, chunks.ordinal,
            chunks.text, chunks.normalizedText, chunks.contentHash,
            chunks.headingPathJson, chunks.locatorJson, chunks.evidenceKind,
            versions.sourceId, sources.userId, sources.placement,
            sources.placementRef
          FROM content_chunks AS chunks
          JOIN content_versions AS versions ON versions.id = chunks.versionId
          JOIN content_sources AS sources ON sources.id = versions.sourceId
          WHERE ${authorization}
            AND chunks.id IN (${ids.map(() => "?").join(",")})`,
        args: authArgs,
      });
      const authorizedRows = rows.rows as unknown as AuthorizedCorpusChunkRow[];
      const rowById = new Map(
        authorizedRows.map((row) => [String(row.chunkId), row]),
      );
      const bodies = await new RoutedCorpusContentReader(
        this.routedClient,
        this.transport,
      ).hydrate(authorizedRows);
      for (const { nodeId, candidate } of nodeCandidates) {
        const row = rowById.get(candidate.chunkId);
        if (!row) continue;
        const locator = sourceLocatorV1Schema.parse(jsonValue(row.locatorJson));
        if (
          String(row.placementRef) !== nodeId ||
          String(row.sourceId) !== candidate.sourceId ||
          String(row.versionId) !== candidate.versionId ||
          Number(row.ordinal) !== candidate.ordinal ||
          String(row.contentHash) !== candidate.contentHash ||
          row.evidenceKind !== candidate.evidenceKind ||
          canonicalJson(locator) !== canonicalJson(candidate.locator)
        ) {
          throw new Error("NODE_RETRIEVAL_CANDIDATE_IDENTITY_MISMATCH");
        }
        const body = bodies.get(candidate.chunkId);
        if (!body) throw new Error("NODE_RETRIEVAL_CHUNK_RESULT_INCOMPLETE");
        candidates.push(
          lexicalCandidateSchema.parse({
            ...candidate,
            snippet: boundedBodySnippet(body.text),
            locator,
            contentHash: String(row.contentHash),
            evidenceKind: row.evidenceKind,
          }),
        );
      }
    }
    const deduplicated = new Map<string, LexicalCandidate>();
    for (const candidate of candidates) {
      const previous = deduplicated.get(candidate.chunkId);
      if (!previous || candidate.score > previous.score) {
        deduplicated.set(candidate.chunkId, candidate);
      }
    }
    return [...deduplicated.values()]
      .sort(
        (left, right) =>
          right.score - left.score || left.chunkId.localeCompare(right.chunkId),
      )
      .slice(0, input.limit);
  }

  override async commitVersion(
    input: Parameters<CoreCorpusStore["commitVersion"]>[0],
  ) {
    const committed = await super.commitVersion(input);
    const versions = await loadCoreVersions(
      this.routedClient,
      input.ownerId,
      [committed.sourceId],
      this.#codec,
    );
    const indexed = versions.find(
      (candidate) => candidate.version.id === committed.versionId,
    );
    if (!indexed) throw new Error("ROUTED_CORPUS_VERSION_MISSING");
    if (indexed.source.placement.kind === "node") {
      // A stale Core index would itself be a plaintext mirror. Purge it before
      // the remote call and keep the source explicitly failed if publication
      // cannot be completed; a repeated idempotent commit can repair it.
      await this.routedClient.execute({
        sql: `DELETE FROM content_chunks_fts WHERE versionId = ?`,
        args: [committed.versionId],
      });
      try {
        await (
          await this.#node(indexed.source.placement.nodeId, input.ownerId)
        ).upsertVersion(indexed);
      } catch (error) {
        await this.routedClient.execute({
          sql: `UPDATE content_sources SET status = 'failed', error = ?,
              updatedAt = ? WHERE id = ? AND userId = ?`,
          args: [
            error instanceof Error ? error.message : "NODE_INDEX_PUBLISH_FAILED",
            Math.floor(Date.now() / 1_000),
            committed.sourceId,
            input.ownerId,
          ],
        });
        throw error;
      }
    } else {
      await this.#local.upsertVersion(indexed);
    }
    return committed;
  }

  async #rewriteRecoveryPayloads(
    transaction: Transaction,
    input: {
      ownerId: string;
      sourceIds: readonly string[];
      versions: readonly LexicalVersionInput[];
      source: CorpusPlanePlacement;
      destination: CorpusPlanePlacement;
    },
  ) {
    const now = Math.floor(Date.now() / 1_000);
    const leaseIds: string[] = [];
    for (const sourceId of input.sourceIds) {
      const leaseId = newId("crwl");
      await transaction.execute({
        sql: `INSERT INTO corpus_payload_rewrite_leases (
            id, userId, sourceId, sourcePlacement, sourceNodeId,
            destinationPlacement, destinationNodeId, expiresAt, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          leaseId,
          input.ownerId,
          sourceId,
          input.source.kind,
          input.source.kind === "node" ? input.source.nodeId : null,
          input.destination.kind,
          input.destination.kind === "node"
            ? input.destination.nodeId
            : null,
          now + 300,
          now,
        ],
      });
      leaseIds.push(leaseId);
    }

    for (const entry of input.versions) {
      for (const chunk of entry.chunks) {
        if (!chunk.chunkId) {
          throw new Error("RETRIEVAL_MIGRATION_CHUNK_ID_MISSING");
        }
        const payload =
          input.destination.kind === "node"
            ? this.#codec.seal({
                ownerId: input.ownerId,
                nodeId: input.destination.nodeId,
                sourceId: entry.source.id,
                versionKey: entry.version.versionKey,
                ordinal: chunk.ordinal,
                contentHash: chunk.contentHash,
                chunk,
              })
            : chunk;
        const changed = await transaction.execute({
          sql: `UPDATE content_chunks
            SET text = ?, normalizedText = ?, headingPathJson = ?
            WHERE id = ? AND versionId = ? AND EXISTS (
              SELECT 1 FROM content_versions AS versions
              JOIN content_sources AS sources ON sources.id = versions.sourceId
              WHERE versions.id = content_chunks.versionId
                AND sources.id = ? AND sources.userId = ?
            )`,
          args: [
            payload.text,
            payload.normalizedText,
            payload.headingPath === null
              ? null
              : canonicalJson(payload.headingPath),
            chunk.chunkId,
            entry.version.id,
            entry.source.id,
            input.ownerId,
          ],
        });
        if (Number(changed.rowsAffected) !== 1) {
          throw new Error("RETRIEVAL_MIGRATION_CHUNK_REWRITE_FAILED");
        }
      }
    }
    return leaseIds;
  }

  async #clearRewriteLeases(
    transaction: Transaction,
    leaseIds: readonly string[],
  ) {
    if (leaseIds.length === 0) return;
    await transaction.execute({
      sql: `DELETE FROM corpus_payload_rewrite_leases
        WHERE id IN (${leaseIds.map(() => "?").join(",")})`,
      args: [...leaseIds],
    });
  }

  /**
   * One-time, fail-closed backfill for pre-envelope Node rows. The canonical
   * Node copy must be online and digest-identical before Core plaintext is
   * replaced. No placement or readable fallback is changed on failure.
   */
  async reconcileNodeEnvelopes(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("NODE_CORPUS_RECONCILE_LIMIT_INVALID");
    }
    const result = await this.routedClient.execute({
      sql: `SELECT DISTINCT sources.id, sources.userId, sources.placementRef
        FROM content_sources AS sources
        JOIN content_versions AS versions ON versions.sourceId = sources.id
        JOIN content_chunks AS chunks ON chunks.versionId = versions.id
        WHERE sources.placement = 'node'
          AND chunks.text NOT LIKE 'avermate-node-chunk:v1:%'
        ORDER BY sources.updatedAt, sources.id LIMIT ?`,
      args: [limit],
    });
    const outcomes: Array<{
      sourceId: string;
      outcome: "sealed" | "offline" | "mismatch" | "failed";
    }> = [];
    for (const row of result.rows) {
      const sourceId = String(row.id);
      const ownerId = String(row.userId);
      const nodeId = String(row.placementRef);
      try {
        if (!(await this.transport.online(nodeId))) {
          outcomes.push({ sourceId, outcome: "offline" });
          continue;
        }
        const local = await loadCoreVersions(
          this.routedClient,
          ownerId,
          [sourceId],
          this.#codec,
        );
        const remote = (
          await this.transport.exportLexicalOwner({ nodeId, ownerId })
        ).filter((entry) => entry.source.id === sourceId);
        if (digestVersions(local) !== digestVersions(remote)) {
          outcomes.push({ sourceId, outcome: "mismatch" });
          continue;
        }
        const transaction = await this.routedClient.transaction("write");
        try {
          const placement = { kind: "node" as const, nodeId };
          const leases = await this.#rewriteRecoveryPayloads(transaction, {
            ownerId,
            sourceIds: [sourceId],
            versions: remote,
            source: placement,
            destination: placement,
          });
          await this.#clearRewriteLeases(transaction, leases);
          await transaction.commit();
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
        outcomes.push({ sourceId, outcome: "sealed" });
      } catch {
        outcomes.push({ sourceId, outcome: "failed" });
      }
    }
    return outcomes;
  }

  async migratePlacement(input: {
    ownerId: string;
    source: CapabilityPlacement;
    destination: CapabilityPlacement;
  }) {
    if (
      !isCorpusPlanePlacement(input.source) ||
      !isCorpusPlanePlacement(input.destination) ||
      samePlacement(input.source, input.destination)
    ) {
      throw new Error("RETRIEVAL_MIGRATION_PLACEMENT_UNSUPPORTED");
    }
    const ids = await sourceIdsAtPlacement(
      this.routedClient,
      input.ownerId,
      input.source,
    );
    let sourceVersions: LexicalVersionInput[];
    if (input.source.kind === "node") {
      const exported = await this.transport.exportLexicalOwner({
        nodeId: input.source.nodeId,
        ownerId: input.ownerId,
      });
      const allowed = new Set(ids);
      sourceVersions = exported.filter((entry) => allowed.has(entry.source.id));
      const coreManifest = await loadCoreVersions(
        this.routedClient,
        input.ownerId,
        ids,
        this.#codec,
      );
      if (digestVersions(coreManifest) !== digestVersions(sourceVersions)) {
        throw new Error("RETRIEVAL_MIGRATION_SOURCE_MANIFEST_MISMATCH");
      }
    } else {
      sourceVersions = await loadCoreVersions(
        this.routedClient,
        input.ownerId,
        ids,
        this.#codec,
      );
    }
    const sourceDigest = digestVersions(sourceVersions);
    if (input.destination.kind === "node") {
      const backend = await this.#node(input.destination.nodeId, input.ownerId);
      for (const entry of sourceVersions) {
        await backend.upsertVersion({
          ...entry,
          source: {
            ...entry.source,
            placement: { kind: "node", nodeId: input.destination.nodeId },
            placementRef: input.destination.nodeId,
          },
        });
      }
      const exported = await this.transport.exportLexicalOwner({
        nodeId: input.destination.nodeId,
        ownerId: input.ownerId,
      });
      const migratedSourceIds = new Set(ids);
      const destinationVersions = exported.filter((entry) =>
        migratedSourceIds.has(entry.source.id),
      );
      const destinationDigest = digestVersions(destinationVersions);
      if (sourceDigest !== destinationDigest) {
        throw new Error("MIGRATION_DIGEST_MISMATCH");
      }
      const transaction = await this.routedClient.transaction("write");
      try {
        if (ids.length > 0) {
          const leases = await this.#rewriteRecoveryPayloads(transaction, {
            ownerId: input.ownerId,
            sourceIds: ids,
            versions: sourceVersions,
            source: input.source,
            destination: input.destination,
          });
          await transaction.execute({
            sql: `DELETE FROM content_chunks_fts WHERE versionId IN (
              SELECT id FROM content_versions WHERE sourceId IN (${ids.map(() => "?").join(",")})
            )`,
            args: [...ids],
          });
          await transaction.execute({
            sql: `UPDATE content_sources SET placement = 'node', placementRef = ?,
              updatedAt = ? WHERE userId = ? AND id IN (${ids.map(() => "?").join(",")})`,
            args: [
              input.destination.nodeId,
              Math.floor(Date.now() / 1_000),
              input.ownerId,
              ...ids,
            ],
          });
          await this.#clearRewriteLeases(transaction, leases);
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return {
        itemCount: sourceVersions.length,
        copiedBytes: new TextEncoder().encode(canonicalJson(sourceVersions)).byteLength,
        sourceDigest,
        destinationDigest,
      };
    }

    const transaction = await this.routedClient.transaction("write");
    let destinationDigest: string;
    try {
      const leases = await this.#rewriteRecoveryPayloads(transaction, {
        ownerId: input.ownerId,
        sourceIds: ids,
        versions: sourceVersions,
        source: input.source,
        destination: input.destination,
      });
      if (ids.length > 0) {
        await transaction.execute({
          sql: `UPDATE content_sources SET placement = 'core', placementRef = NULL,
            updatedAt = ? WHERE userId = ? AND id IN (${ids.map(() => "?").join(",")})`,
          args: [Math.floor(Date.now() / 1_000), input.ownerId, ...ids],
        });
      }
      for (const entry of sourceVersions) {
        await transaction.execute({
          sql: `DELETE FROM content_chunks_fts WHERE versionId = ?`,
          args: [entry.version.id],
        });
        for (const chunk of entry.chunks) {
          if (!chunk.chunkId) {
            throw new Error("RETRIEVAL_MIGRATION_CHUNK_ID_MISSING");
          }
          await transaction.execute({
            sql: `INSERT INTO content_chunks_fts
              (chunkId, versionId, sourceId, ownerId, text, normalizedText)
              SELECT chunks.id, versions.id, sources.id, sources.userId, ?, ?
              FROM content_chunks AS chunks
              JOIN content_versions AS versions ON versions.id = chunks.versionId
              JOIN content_sources AS sources ON sources.id = versions.sourceId
              WHERE chunks.id = ? AND versions.id = ? AND sources.id = ?
                AND sources.userId = ? AND sources.placement = 'core'`,
            args: [
              chunk.text,
              chunk.normalizedText,
              chunk.chunkId,
              entry.version.id,
              entry.source.id,
              input.ownerId,
            ],
          });
        }
      }
      destinationDigest = digestVersions(
        await loadLocalIndexedVersions(
          transaction,
          input.ownerId,
          sourceVersions,
        ),
      );
      if (sourceDigest !== destinationDigest) {
        throw new Error("MIGRATION_DIGEST_MISMATCH");
      }
      await this.#clearRewriteLeases(transaction, leases);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return {
      itemCount: sourceVersions.length,
      copiedBytes: new TextEncoder().encode(canonicalJson(sourceVersions)).byteLength,
      sourceDigest,
      destinationDigest,
    };
  }
}

export const routedCorpusStore = new RoutedCorpusStore();
registerPlacementMigrationAdapter("retrieval", (input) =>
  routedCorpusStore.migratePlacement(input),
);

export type RoutedLexicalSearch = Pick<LexicalSearchBackend, "search">;
