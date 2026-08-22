import type { Client, InStatement, Transaction } from "@libsql/client";
import {
  contentSourceRecordSchema,
  contentVersionReferenceSchema,
  contentVersionRecordSchema,
  sourceLocatorV1Schema,
  stagedContentVersionSchema,
  type CommitVersionInput,
  type CommittedVersionRef,
  type ContentSourceRecord,
  type ContentVersionRecord,
  type ContentVersionReference,
  type CorpusCoverage,
  type CorpusPlacement,
  type CorpusStore,
  type OwnedSourceIdentity,
  type OwnedVersionRef,
  type SourceLocatorV1,
  type StagedContentVersion,
  type StagedVersionRef,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { newId } from "../lib/id";
import {
  canonicalJson,
  isoFromSqlite,
  jsonValue,
  referenceKey,
} from "./values";

type SqlClient = Pick<Client, "execute" | "batch" | "transaction">;

type RegisterSourceInput = OwnedSourceIdentity & {
  yearId: string | null;
  subjectId: string | null;
  coverage: CorpusCoverage;
  placement?: CorpusPlacement;
};

type ReferenceInput = {
  ownerId: string;
  ownerKind:
    | "project-item"
    | "assistant-citation"
    | "conversation-summary"
    | "artifact-revision"
    | "export";
  ownerIdWithinKind: string;
  sourceVersionId: string;
  chunkId: string | null;
  locator: SourceLocatorV1;
  quotedContentHash?: string | null;
};

export type CommittedContentAssetInput = {
  fileId: string;
  role: "inline-image" | "page-image" | "thumbnail" | "attachment";
  locator: SourceLocatorV1 | null;
  altText: string | null;
  contentHash: string;
};

function sourceFromRow(row: Record<string, unknown>): ContentSourceRecord {
  const placement: CorpusPlacement =
    row.placement === "node"
      ? { kind: "node", nodeId: String(row.placementRef) }
      : { kind: "core" };
  return contentSourceRecordSchema.parse({
    id: String(row.id),
    ownerId: String(row.userId),
    originKind: row.originKind,
    originId: String(row.originId),
    yearId: row.yearId === null ? null : String(row.yearId),
    subjectId: row.subjectId === null ? null : String(row.subjectId),
    currentVersionId:
      row.currentVersionId === null ? null : String(row.currentVersionId),
    status: row.status,
    coverage: row.coverage,
    placement,
    placementRef: row.placementRef === null ? null : String(row.placementRef),
    createdAt: isoFromSqlite(row.createdAt),
    updatedAt: isoFromSqlite(row.updatedAt),
  });
}

function versionFromRow(row: Record<string, unknown>): ContentVersionRecord {
  return contentVersionRecordSchema.parse({
    id: String(row.id),
    sourceId: String(row.sourceId),
    versionKey: String(row.versionKey),
    contentHash: String(row.contentHash),
    extractorId: String(row.extractorId),
    extractorVersion: String(row.extractorVersion),
    mimeType: row.mimeType === null ? null : String(row.mimeType),
    language: row.language === null ? null : String(row.language),
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
    locatorSchemaVersion: 1,
    metadata: jsonValue<Record<string, unknown>>(row.metadataJson),
    createdAt: isoFromSqlite(row.createdAt),
  });
}

function referenceFromRow(
  row: Record<string, unknown>,
): ContentVersionReference {
  return contentVersionReferenceSchema.parse({
    id: String(row.id),
    ownerId: String(row.userId),
    ownerKind: row.ownerKind,
    ownerIdWithinKind: String(row.ownerId),
    sourceVersionId: String(row.sourceVersionId),
    chunkId: row.chunkId === null ? null : String(row.chunkId),
    locatorSchemaVersion: 1,
    locator: jsonValue(row.locatorJson),
    quotedContentHash:
      row.quotedContentHash === null ? null : String(row.quotedContentHash),
    referenceKey: String(row.referenceKey),
    createdAt: isoFromSqlite(row.createdAt),
  });
}

function inferCoverage(input: StagedContentVersion): CorpusCoverage {
  if (input.chunks.some((chunk) => chunk.evidenceKind === "ocr")) {
    return "searchable-ocr";
  }
  if (
    input.chunks.some(
      (chunk) =>
        chunk.evidenceKind === "native-text" ||
        chunk.evidenceKind === "transcript",
    )
  ) {
    return "searchable-native-text";
  }
  if (input.chunks.some((chunk) => chunk.evidenceKind === "visual-only")) {
    return "metadata-and-locators-only";
  }
  return "unsupported";
}

async function execute(
  target: SqlClient | Transaction,
  statement: InStatement,
) {
  return target.execute(statement);
}

export class CoreCorpusStore implements CorpusStore {
  constructor(private readonly client: SqlClient = db.$client) {}

  async registerSource(
    input: RegisterSourceInput,
  ): Promise<ContentSourceRecord> {
    const placement = input.placement ?? { kind: "core" as const };
    const id = newId("csrc");
    const now = Math.floor(Date.now() / 1_000);
    await this.client.execute({
      sql: `
        INSERT INTO content_sources (
          id, userId, yearId, subjectId, originKind, originId, status,
          coverage, placement, placementRef, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, 'registered', ?, ?, ?, ?, ?)
        ON CONFLICT(userId, originKind, originId) DO UPDATE SET
          yearId = excluded.yearId,
          subjectId = excluded.subjectId,
          coverage = CASE
            WHEN content_sources.status IN ('ready', 'partial')
              THEN content_sources.coverage
            ELSE excluded.coverage
          END,
          updatedAt = excluded.updatedAt
      `,
      args: [
        id,
        input.ownerId,
        input.yearId,
        input.subjectId,
        input.originKind,
        input.originId,
        input.coverage,
        placement.kind,
        placement.kind === "node" ? placement.nodeId : null,
        now,
        now,
      ],
    });
    const source = await this.getSource(input);
    if (!source) throw new Error("The corpus source could not be registered");
    return source;
  }

  async getSource(
    identity: OwnedSourceIdentity,
  ): Promise<ContentSourceRecord | null> {
    const result = await this.client.execute({
      sql: `
        SELECT * FROM content_sources
        WHERE userId = ? AND originKind = ? AND originId = ?
        LIMIT 1
      `,
      args: [identity.ownerId, identity.originKind, identity.originId],
    });
    const row = result.rows[0];
    return row ? sourceFromRow(row) : null;
  }

  async stageVersion(
    rawInput: StagedContentVersion,
  ): Promise<StagedVersionRef> {
    const input = stagedContentVersionSchema.parse(rawInput);
    const source = await this.getSource(input.identity);
    if (!source || source.id !== input.sourceId) {
      throw new Error("The staged source identity is not owned");
    }
    if (source.placement.kind !== "core") {
      throw new Error("CoreCorpusStore cannot stage a node-placed source");
    }
    const ordinals = new Set(input.chunks.map((chunk) => chunk.ordinal));
    if (ordinals.size !== input.chunks.length) {
      throw new Error("Staged chunk ordinals must be unique");
    }

    const existingVersion = await this.client.execute({
      sql: `SELECT * FROM content_versions WHERE sourceId = ? AND versionKey = ? LIMIT 1`,
      args: [source.id, input.versionKey],
    });
    const committed = existingVersion.rows[0];
    if (committed && String(committed.contentHash) !== input.contentHash) {
      throw new Error("A stable version key cannot identify different content");
    }

    const existingStage = await this.client.execute({
      sql: `SELECT * FROM corpus_version_stages WHERE sourceId = ? AND versionKey = ? LIMIT 1`,
      args: [source.id, input.versionKey],
    });
    if (existingStage.rows[0]) {
      if (String(existingStage.rows[0].contentHash) !== input.contentHash) {
        throw new Error(
          "A staged version key already identifies different content",
        );
      }
      return {
        ownerId: input.identity.ownerId,
        sourceId: source.id,
        versionId: String(existingStage.rows[0].versionId),
        stagingId: String(existingStage.rows[0].id),
      };
    }

    const stagingId = newId("cstage");
    const versionId = committed ? String(committed.id) : newId("cver");
    const now = Math.floor(Date.now() / 1_000);
    const transaction = await this.client.transaction("write");
    try {
      await execute(transaction, {
        sql: `
          INSERT INTO corpus_version_stages (
            id, versionId, sourceId, userId, versionKey, contentHash,
            extractorId, extractorVersion, mimeType, language, byteSize,
            locatorSchemaVersion, metadataJson, coverage, alreadyCommitted, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `,
        args: [
          stagingId,
          versionId,
          source.id,
          input.identity.ownerId,
          input.versionKey,
          input.contentHash,
          input.extractorId,
          input.extractorVersion,
          input.mimeType,
          input.language,
          input.byteSize,
          canonicalJson(input.metadata),
          inferCoverage(input),
          committed ? 1 : 0,
          now,
        ],
      });
      if (!committed) {
        for (const chunk of input.chunks) {
          await execute(transaction, {
            sql: `
              INSERT INTO corpus_chunk_stages (
                id, stagingId, chunkId, ordinal, text, normalizedText,
                tokenEstimate, contentHash, locatorJson, headingPathJson,
                evidenceKind
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
              newId("schk"),
              stagingId,
              newId("chk"),
              chunk.ordinal,
              chunk.text,
              chunk.normalizedText,
              chunk.tokenEstimate,
              chunk.contentHash,
              canonicalJson(chunk.locator),
              chunk.headingPath === null
                ? null
                : canonicalJson(chunk.headingPath),
              chunk.evidenceKind,
            ],
          });
        }
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return {
      ownerId: input.identity.ownerId,
      sourceId: source.id,
      versionId,
      stagingId,
    };
  }

  async commitVersion(
    input: CommitVersionInput & {
      assets?: readonly CommittedContentAssetInput[];
    },
  ): Promise<CommittedVersionRef> {
    const transaction = await this.client.transaction("write");
    try {
      const stageResult = await execute(transaction, {
        sql: `SELECT * FROM corpus_version_stages WHERE id = ? AND userId = ? AND sourceId = ? LIMIT 1`,
        args: [input.stagingId, input.ownerId, input.expectedSourceId],
      });
      const stage = stageResult.rows[0];
      if (!stage) throw new Error("The staged corpus version was not found");

      const sourceResult = await execute(transaction, {
        sql: `SELECT * FROM content_sources WHERE id = ? AND userId = ? LIMIT 1`,
        args: [input.expectedSourceId, input.ownerId],
      });
      const source = sourceResult.rows[0];
      if (!source) throw new Error("The corpus source was not found");
      const current =
        source.currentVersionId === null
          ? null
          : String(source.currentVersionId);
      if (current !== input.expectedPreviousVersionId) {
        throw new Error("The corpus source changed before version commit");
      }

      if (Number(stage.alreadyCommitted) === 0) {
        await execute(transaction, {
          sql: `
            INSERT INTO content_versions (
              id, sourceId, versionKey, contentHash, extractorId,
              extractorVersion, mimeType, language, byteSize,
              locatorSchemaVersion, metadataJson, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `,
          args: [
            stage.versionId,
            stage.sourceId,
            stage.versionKey,
            stage.contentHash,
            stage.extractorId,
            stage.extractorVersion,
            stage.mimeType,
            stage.language,
            stage.byteSize,
            stage.metadataJson,
            stage.createdAt,
          ],
        });
        await execute(transaction, {
          sql: `
            INSERT INTO content_chunks (
              id, versionId, ordinal, text, normalizedText, tokenEstimate,
              contentHash, locatorJson, headingPathJson, evidenceKind, createdAt
            )
            SELECT chunkId, ?, ordinal, text, normalizedText, tokenEstimate,
              contentHash, locatorJson, headingPathJson, evidenceKind, ?
            FROM corpus_chunk_stages
            WHERE stagingId = ?
            ORDER BY ordinal
          `,
          args: [stage.versionId, stage.createdAt, stage.id],
        });
      }

      for (const asset of input.assets ?? []) {
        const locatorJson =
          asset.locator === null ? null : canonicalJson(asset.locator);
        if (asset.locator !== null) sourceLocatorV1Schema.parse(asset.locator);
        const existingAsset = await execute(transaction, {
          sql: `
            SELECT assets.id
            FROM content_assets AS assets
            JOIN files ON files.id = assets.fileId
            WHERE assets.versionId = ? AND assets.contentHash = ?
              AND assets.role = ? AND assets.locatorJson IS ?
              AND files.userId = ? AND files.status = 'stored'
            LIMIT 1
          `,
          args: [
            stage.versionId,
            asset.contentHash,
            asset.role,
            locatorJson,
            input.ownerId,
          ],
        });
        if (existingAsset.rows.length > 0) continue;
        const inserted = await execute(transaction, {
          sql: `
            INSERT INTO content_assets (
              id, versionId, fileId, role, locatorJson, altText, contentHash
            )
            SELECT ?, ?, files.id, ?, ?, ?, ?
            FROM files
            WHERE files.id = ? AND files.userId = ? AND files.status = 'stored'
          `,
          args: [
            newId("casset"),
            stage.versionId,
            asset.role,
            locatorJson,
            asset.altText,
            asset.contentHash,
            asset.fileId,
            input.ownerId,
          ],
        });
        if (Number(inserted.rowsAffected) !== 1) {
          throw new Error(
            "A captured corpus asset is not an owned stored file",
          );
        }
      }

      const status =
        stage.coverage === "unsupported" ||
        stage.coverage === "metadata-and-locators-only"
          ? "partial"
          : "ready";
      const changed = await execute(transaction, {
        sql: `
          UPDATE content_sources
          SET currentVersionId = ?, status = ?, coverage = ?, error = NULL,
              updatedAt = ?
          WHERE id = ? AND userId = ? AND currentVersionId IS ?
        `,
        args: [
          stage.versionId,
          status,
          stage.coverage,
          Math.floor(Date.now() / 1_000),
          stage.sourceId,
          input.ownerId,
          input.expectedPreviousVersionId,
        ],
      });
      if (Number(changed.rowsAffected) !== 1) {
        throw new Error("The corpus source changed before pointer publication");
      }
      await execute(transaction, {
        sql: `DELETE FROM corpus_version_stages WHERE id = ?`,
        args: [stage.id],
      });
      await transaction.commit();
      return {
        ownerId: input.ownerId,
        sourceId: String(stage.sourceId),
        versionId: String(stage.versionId),
        contentHash: String(stage.contentHash),
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async resolveVersion(ref: OwnedVersionRef): Promise<ContentVersionRecord> {
    const result = await this.client.execute({
      sql: `
        SELECT versions.*
        FROM content_versions AS versions
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE versions.id = ? AND versions.sourceId = ? AND sources.userId = ?
        LIMIT 1
      `,
      args: [ref.versionId, ref.sourceId, ref.ownerId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("The owned corpus version was not found");
    return versionFromRow(row);
  }

  async listReferences(versionId: string): Promise<ContentVersionReference[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM content_version_references WHERE sourceVersionId = ? ORDER BY createdAt, id`,
      args: [versionId],
    });
    return result.rows.map(referenceFromRow);
  }

  async createReference(
    input: ReferenceInput,
  ): Promise<ContentVersionReference> {
    const locator = sourceLocatorV1Schema.parse(input.locator);
    const key = referenceKey({
      sourceVersionId: input.sourceVersionId,
      chunkId: input.chunkId,
      locatorSchemaVersion: 1,
      locator,
    });
    const id = newId("cref");
    const now = Math.floor(Date.now() / 1_000);
    await this.client.execute({
      sql: `
        INSERT INTO content_version_references (
          id, userId, ownerKind, ownerId, sourceVersionId, chunkId,
          locatorSchemaVersion, locatorJson, quotedContentHash, referenceKey,
          createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(ownerKind, ownerId, referenceKey) DO NOTHING
      `,
      args: [
        id,
        input.ownerId,
        input.ownerKind,
        input.ownerIdWithinKind,
        input.sourceVersionId,
        input.chunkId,
        canonicalJson(locator),
        input.quotedContentHash ?? null,
        key,
        now,
      ],
    });
    const result = await this.client.execute({
      sql: `
        SELECT * FROM content_version_references
        WHERE ownerKind = ? AND ownerId = ? AND referenceKey = ? AND userId = ?
        LIMIT 1
      `,
      args: [input.ownerKind, input.ownerIdWithinKind, key, input.ownerId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("The citation reference could not be created");
    return referenceFromRow(row);
  }

  async markVersionForGc(versionId: string): Promise<void> {
    await this.client.execute({
      sql: `
        UPDATE content_versions
        SET gcRequestedAt = ?
        WHERE id = ?
          AND NOT EXISTS (
            SELECT 1 FROM content_sources
            WHERE currentVersionId = content_versions.id
          )
      `,
      args: [Math.floor(Date.now() / 1_000), versionId],
    });
  }

  async ownsVersion(ownerId: string, versionId: string) {
    const result = await this.client.execute({
      sql: `
        SELECT 1 AS owned
        FROM content_versions AS versions
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE versions.id = ? AND sources.userId = ? LIMIT 1
      `,
      args: [versionId, ownerId],
    });
    return result.rows.length > 0;
  }

  async collectGarbage(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const transaction = await this.client.transaction("write");
    try {
      const candidates = await execute(transaction, {
        sql: `
          SELECT versions.id
          FROM content_versions AS versions
          WHERE versions.gcRequestedAt IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM content_sources AS sources
              WHERE sources.currentVersionId = versions.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM content_version_references AS refs
              WHERE refs.sourceVersionId = versions.id
            )
          ORDER BY versions.gcRequestedAt, versions.id
          LIMIT ?
        `,
        args: [boundedLimit],
      });
      const ids = candidates.rows.map((row) => String(row.id));
      for (const id of ids) {
        await execute(transaction, {
          sql: `DELETE FROM content_versions WHERE id = ?`,
          args: [id],
        });
      }
      await transaction.commit();
      return { deletedVersionIds: ids };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async setSourceFailure(identity: OwnedSourceIdentity, error: unknown) {
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/https?:\/\/\S+/g, "[remote service]")
      .slice(0, 2_000);
    await this.client.execute({
      sql: `
        UPDATE content_sources
        SET status = CASE WHEN currentVersionId IS NULL THEN 'failed' ELSE 'partial' END,
            error = ?, updatedAt = ?
        WHERE userId = ? AND originKind = ? AND originId = ?
      `,
      args: [
        message,
        Math.floor(Date.now() / 1_000),
        identity.ownerId,
        identity.originKind,
        identity.originId,
      ],
    });
  }
}
