import type { Client } from "@libsql/client";
import type {
  CommittedVersionRef,
  OwnedSourceIdentity,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { deleteFile, storeFile } from "../lib/storage";
import { CoreCorpusStore } from "./core-corpus-store";
import { routedCorpusStore } from "./routed-corpus-store";
import {
  createCoreSourceRegistry,
  stagedVersionFromSnapshot,
  type IndexableSourceRegistry,
  type SourceExtractionSelector,
} from "./adapters";
import { jsonValue } from "./values";
import type { PendingContentAsset } from "./assets";
import type { CommittedContentAssetInput } from "./core-corpus-store";

type SqlClient = Pick<Client, "execute" | "batch" | "transaction">;

export class CorpusIndexService {
  constructor(
    private readonly client: SqlClient = db.$client,
    readonly store: CoreCorpusStore =
      client === db.$client ? routedCorpusStore : new CoreCorpusStore(client),
    readonly registry: IndexableSourceRegistry = createCoreSourceRegistry(
      client,
    ),
  ) {}

  async ensureRegistered(identity: OwnedSourceIdentity) {
    const descriptor = await this.registry.describe(identity);
    return this.store.registerSource({
      ...identity,
      yearId: descriptor.yearId,
      subjectId: descriptor.subjectId,
      coverage: descriptor.coverage,
    });
  }

  async indexSource(
    identity: OwnedSourceIdentity,
    options: {
      signal?: AbortSignal;
      selector?: SourceExtractionSelector;
      projectItemId?: string;
    } = {},
  ): Promise<CommittedVersionRef> {
    options.signal?.throwIfAborted();
    const source = await this.ensureRegistered(identity);
    await this.client.execute({
      sql: `UPDATE content_sources SET status = 'indexing', error = NULL, updatedAt = ? WHERE id = ? AND userId = ?`,
      args: [Math.floor(Date.now() / 1_000), source.id, identity.ownerId],
    });
    const createdAssetFileIds: string[] = [];
    let published = false;
    try {
      const snapshot = await this.registry.extract(identity, options.selector);
      options.signal?.throwIfAborted();
      const assets = await this.prepareAssets(
        identity.ownerId,
        snapshot.assets ?? [],
        createdAssetFileIds,
      );
      options.signal?.throwIfAborted();
      const staged = await this.store.stageVersion(
        stagedVersionFromSnapshot(snapshot, source.id),
      );
      // This is the publication fence: cancellation/failure before commit
      // leaves the previous current version and FTS rows untouched.
      options.signal?.throwIfAborted();
      const latest = await this.store.getSource(identity);
      if (!latest)
        throw new Error("The corpus source disappeared while indexing");
      const committed = await this.store.commitVersion({
        ownerId: identity.ownerId,
        stagingId: staged.stagingId,
        expectedSourceId: source.id,
        expectedPreviousVersionId: latest.currentVersionId,
        assets,
      });
      published = true;
      await this.snapshotProjectReferences(
        identity,
        committed.versionId,
        options.projectItemId,
      );
      return committed;
    } catch (error) {
      if (!published) {
        await Promise.allSettled(
          createdAssetFileIds.map((fileId) =>
            deleteFile(identity.ownerId, fileId),
          ),
        );
      }
      await this.store.setSourceFailure(identity, error);
      throw error;
    }
  }

  private async prepareAssets(
    ownerId: string,
    assets: readonly PendingContentAsset[],
    createdFileIds: string[],
  ): Promise<CommittedContentAssetInput[]> {
    const fileByHash = new Map<string, string>();
    const prepared: CommittedContentAssetInput[] = [];
    for (const asset of assets) {
      let fileId = fileByHash.get(asset.contentHash);
      if (!fileId) {
        const existing = await this.client.execute({
          sql: `
            SELECT assets.fileId
            FROM content_assets AS assets
            JOIN content_versions AS versions ON versions.id = assets.versionId
            JOIN content_sources AS sources ON sources.id = versions.sourceId
            JOIN files ON files.id = assets.fileId
            WHERE sources.userId = ? AND files.userId = ?
              AND files.status = 'stored' AND assets.contentHash = ?
            ORDER BY versions.createdAt DESC LIMIT 1
          `,
          args: [ownerId, ownerId, asset.contentHash],
        });
        fileId = existing.rows[0]?.fileId
          ? String(existing.rows[0].fileId)
          : undefined;
      }
      if (!fileId) {
        const bytes = new Uint8Array(asset.bytes);
        const stored = await storeFile({
          userId: ownerId,
          purpose: "course-material",
          nameHint: `${asset.contentHash}.webp`,
          file: new File([bytes], `${asset.contentHash}.webp`, {
            type: asset.mimeType,
          }),
        });
        fileId = stored.id;
        createdFileIds.push(fileId);
      }
      fileByHash.set(asset.contentHash, fileId);
      prepared.push({
        fileId,
        role: asset.role,
        locator: asset.locator,
        altText: asset.altText,
        contentHash: asset.contentHash,
      });
    }
    return prepared;
  }

  private async snapshotProjectReferences(
    identity: OwnedSourceIdentity,
    versionId: string,
    selectedProjectItemId?: string,
  ) {
    const items = await this.client.execute({
      sql: `
        SELECT items.id, items.trackingMode, items.sourceVersionId
        FROM study_project_items AS items
        JOIN study_projects AS projects ON projects.id = items.projectId
        WHERE projects.userId = ? AND items.kind = ? AND items.referenceId = ?
      `,
      args: [identity.ownerId, identity.originKind, identity.originId],
    });
    if (items.rows.length === 0) return;
    const first = await this.client.execute({
      sql: `SELECT id, locatorJson FROM content_chunks WHERE versionId = ? ORDER BY ordinal LIMIT 1`,
      args: [versionId],
    });
    const chunk = first.rows[0];
    if (!chunk) return;
    for (const item of items.rows) {
      const itemId = String(item.id);
      const followsHead = item.trackingMode === "follow-head";
      const isSelectedPinnedItem =
        item.trackingMode === "pinned" && selectedProjectItemId === itemId;
      if (!followsHead && !isSelectedPinnedItem) continue;
      const updated = await this.client.execute({
        sql: `UPDATE study_project_items SET sourceVersionId = ?
          WHERE id = ? AND (trackingMode = 'follow-head' OR id = ?)`,
        args: [versionId, itemId, selectedProjectItemId ?? ""],
      });
      if (Number(updated.rowsAffected) !== 1) continue;
      await this.store.createReference({
        ownerId: identity.ownerId,
        ownerKind: "project-item",
        ownerIdWithinKind: itemId,
        sourceVersionId: versionId,
        chunkId: null,
        locator: jsonValue(chunk.locatorJson),
      });
    }
  }

  async staleSources(ownerId?: string) {
    const result = await this.client.execute({
      sql: `
        SELECT userId, originKind, originId, currentVersionId
        FROM content_sources
        WHERE placement = 'core' ${ownerId ? "AND userId = ?" : ""}
        ORDER BY userId, originKind, originId
      `,
      args: ownerId ? [ownerId] : [],
    });
    const stale: OwnedSourceIdentity[] = [];
    for (const row of result.rows) {
      const identity = {
        ownerId: String(row.userId),
        originKind: row.originKind as OwnedSourceIdentity["originKind"],
        originId: String(row.originId),
      };
      if (identity.originKind === "conversation") continue;
      try {
        const snapshot = await this.registry.extract(identity);
        const current =
          row.currentVersionId === null
            ? null
            : await this.client.execute({
                sql: `SELECT versionKey FROM content_versions WHERE id = ? LIMIT 1`,
                args: [row.currentVersionId],
              });
        if (
          !current ||
          current.rows.length === 0 ||
          String(current.rows[0]?.versionKey) !== snapshot.versionKey
        ) {
          stale.push(identity);
        }
      } catch {
        // Deleted domain rows are handled by the remove/GC path, not reindexed.
      }
    }
    return stale;
  }

  async repair(options: { ownerId?: string; signal?: AbortSignal } = {}) {
    const stale = await this.staleSources(options.ownerId);
    const repaired: string[] = [];
    for (const identity of stale) {
      options.signal?.throwIfAborted();
      repaired.push((await this.indexSource(identity, options)).versionId);
    }
    return { stale: stale.length, repairedVersionIds: repaired };
  }
}

export const coreCorpusIndexService = new CorpusIndexService();
