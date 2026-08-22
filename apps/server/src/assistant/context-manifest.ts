import type { Transaction } from "@libsql/client";
import {
  assistantContextManifestSchema,
  contextManifestItemSchema,
  sourceLocatorV1Schema,
  type AssistantContextManifest,
  type ContextProofHandle,
  type SourceLocatorV1,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import { CoreCorpusStore } from "../search/core-corpus-store";
import {
  canonicalJson,
  isoFromSqlite,
  jsonValue,
  sha256,
} from "../search/values";
import {
  ConversationStoreError,
  type AssistantSqlClient,
} from "./core-conversation-store";

type ManifestItem = Parameters<typeof contextManifestItemSchema.parse>[0];

export type ContextEvidenceInput = {
  sourceVersionId: string;
  chunkId: string | null;
  locator: SourceLocatorV1;
  evidenceDigest: string;
  quotedContentHash?: string | null;
};

export class AssistantContextManifestService {
  private readonly corpus: CoreCorpusStore;

  constructor(private readonly client: AssistantSqlClient) {
    this.corpus = new CoreCorpusStore(client);
  }

  async commit(input: {
    ownerId: string;
    runId: string;
    budget: {
      maxTokens: number;
      usedTokens: number;
      reservedOutputTokens: number;
    };
    items: ManifestItem[];
    evidence: ContextEvidenceInput[];
  }): Promise<AssistantContextManifest> {
    const runResult = await this.client.execute({
      sql: `SELECT r.* FROM assistant_runs r JOIN assistant_threads t ON t.id = r.threadId
        WHERE r.id = ? AND r.userId = ? AND t.userId = ? AND t.deletedAt IS NULL LIMIT 1`,
      args: [input.runId, input.ownerId, input.ownerId],
    });
    const run = runResult.rows[0];
    if (!run) throw new ConversationStoreError("not_found", "Run not found");
    if (
      !["reserved", "running", "waiting-for-user"].includes(String(run.status))
    ) {
      throw new ConversationStoreError(
        "invalid_state",
        "A terminal run cannot receive another context manifest",
      );
    }
    if (
      input.budget.usedTokens + input.budget.reservedOutputTokens >
      input.budget.maxTokens
    ) {
      throw new Error("Context manifest exceeds its declared token budget");
    }
    const items = input.items.map((item) =>
      contextManifestItemSchema.parse(item),
    );
    const references = [];
    for (const evidence of input.evidence) {
      sourceLocatorV1Schema.parse(evidence.locator);
      if (!/^[a-f0-9]{64}$/.test(evidence.evidenceDigest)) {
        throw new Error("Evidence digest must be SHA-256");
      }
      references.push({
        evidence,
        reference: await this.corpus.createReference({
          ownerId: input.ownerId,
          ownerKind: "assistant-citation",
          ownerIdWithinKind: input.runId,
          sourceVersionId: evidence.sourceVersionId,
          chunkId: evidence.chunkId,
          locator: evidence.locator,
          quotedContentHash: evidence.quotedContentHash ?? null,
        }),
      });
    }

    const manifestId = newId("acmf");
    const digest = sha256(
      canonicalJson({
        version: 1,
        budget: input.budget,
        items,
        evidence: input.evidence,
      }),
    );
    const transaction = await this.client.transaction("write");
    try {
      const revisionRow = await transaction.execute({
        sql: `SELECT coalesce(max(revision), 0) + 1 AS revision
          FROM assistant_context_manifests WHERE runId = ?`,
        args: [input.runId],
      });
      const revision = Number(revisionRow.rows[0]?.revision ?? 1);
      const now = Math.floor(Date.now() / 1_000);
      await transaction.execute({
        sql: `INSERT INTO assistant_context_manifests
          (id, runId, version, revision, budgetJson, itemsJson, digest,
           committedAt, createdAt)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        args: [
          manifestId,
          input.runId,
          revision,
          canonicalJson(input.budget),
          canonicalJson(items),
          digest,
          now,
          now,
        ],
      });
      for (let ordinal = 0; ordinal < references.length; ordinal += 1) {
        const { evidence, reference } = references[ordinal]!;
        await transaction.execute({
          sql: `INSERT INTO assistant_context_proof_handles
            (id, contextManifestId, runId, ordinal, contentVersionReferenceId,
             sourceVersionId, chunkId, locatorSchemaVersion, locatorJson,
             evidenceDigest, quotedContentHash, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          args: [
            newId("aprf"),
            manifestId,
            input.runId,
            ordinal,
            reference.id,
            evidence.sourceVersionId,
            evidence.chunkId,
            canonicalJson(evidence.locator),
            evidence.evidenceDigest,
            evidence.quotedContentHash ?? null,
            now,
          ],
        });
      }
      await transaction.execute({
        sql: `UPDATE assistant_runs SET contextManifestId = ?, updatedAt = ?
          WHERE id = ? AND userId = ?`,
        args: [manifestId, now, input.runId, input.ownerId],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return this.get(input.ownerId, manifestId);
  }

  async get(
    ownerId: string,
    manifestId: string,
  ): Promise<AssistantContextManifest> {
    const result = await this.client.execute({
      sql: `SELECT m.* FROM assistant_context_manifests m
        JOIN assistant_runs r ON r.id = m.runId
        WHERE m.id = ? AND r.userId = ? LIMIT 1`,
      args: [manifestId, ownerId],
    });
    const manifest = result.rows[0];
    if (!manifest)
      throw new ConversationStoreError("not_found", "Manifest not found");
    const handles = await this.client.execute({
      sql: `SELECT p.*, ref.userId AS referenceUserId, ref.ownerKind,
        ref.ownerId AS referenceOwnerId, ref.referenceKey,
        ref.createdAt AS referenceCreatedAt
        FROM assistant_context_proof_handles p
        JOIN content_version_references ref ON ref.id = p.contentVersionReferenceId
        WHERE p.contextManifestId = ? ORDER BY p.ordinal`,
      args: [manifestId],
    });
    const proofHandles: ContextProofHandle[] = handles.rows.map((row) => ({
      id: String(row.id),
      contextManifestId: String(row.contextManifestId),
      runId: String(row.runId),
      ordinal: Number(row.ordinal),
      contentVersionReference: {
        id: String(row.contentVersionReferenceId),
        ownerId: String(row.referenceUserId),
        ownerKind: row.ownerKind as "assistant-citation",
        ownerIdWithinKind: String(row.referenceOwnerId),
        sourceVersionId: String(row.sourceVersionId),
        chunkId: row.chunkId === null ? null : String(row.chunkId),
        locatorSchemaVersion: 1,
        locator: sourceLocatorV1Schema.parse(jsonValue(row.locatorJson)),
        quotedContentHash:
          row.quotedContentHash === null ? null : String(row.quotedContentHash),
        referenceKey: String(row.referenceKey),
        createdAt: isoFromSqlite(row.referenceCreatedAt),
      },
      locator: sourceLocatorV1Schema.parse(jsonValue(row.locatorJson)),
      evidenceDigest: String(row.evidenceDigest),
      quotedContentHash:
        row.quotedContentHash === null ? null : String(row.quotedContentHash),
      createdAt: isoFromSqlite(row.createdAt),
    }));
    return assistantContextManifestSchema.parse({
      id: String(manifest.id),
      runId: String(manifest.runId),
      version: Number(manifest.version),
      revision: Number(manifest.revision),
      budget: jsonValue(manifest.budgetJson),
      items: jsonValue(manifest.itemsJson),
      proofHandles,
      digest: String(manifest.digest),
      committedAt: isoFromSqlite(manifest.committedAt),
    });
  }
}
