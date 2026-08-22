import type { Client, InStatement, Transaction } from "@libsql/client";
import {
  generatedArtifactKindSchema,
  generatedArtifactManifestV1Schema,
  type GeneratedArtifactKind,
  type GeneratedArtifactManifestV1,
  type ModelRunReference,
  type VideoTimelineV1,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { newId } from "../lib/id";
import { canonicalJson, jsonValue, sha256 } from "../search/values";
import {
  createArtifactManifest,
  manifestFromLegacyDocumentArtifact,
  type LegacyDocumentArtifactSnapshot,
} from "./artifact-manifest";
import { validateVideoTimeline, type TimelineReferenceResolver } from "./timeline";
import { artifactWorkflowPlan, stageInputDigest } from "./workflow";

type SqlClient = Pick<Client, "execute" | "transaction">;

async function execute(target: SqlClient | Transaction, statement: InStatement) {
  return target.execute(statement);
}

function now() {
  return Math.floor(Date.now() / 1_000);
}

function stableId(prefix: string, ownerId: string, idempotencyKey: string) {
  return `${prefix}_${sha256(canonicalJson([ownerId, idempotencyKey])).slice(0, 24)}`;
}

function string(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

export class CoreArtifactGraphStore {
  constructor(private readonly client: SqlClient = db.$client) {}

  async plan(input: {
    ownerId: string;
    projectId?: string | null;
    kind: GeneratedArtifactKind;
    title: string;
    sourceVersionIds?: readonly string[];
    parentArtifactRevisionIds?: readonly string[];
    settings?: unknown;
    placement: "core" | "node" | "unavailable";
    placementRef?: string | null;
    policyRef: string;
    idempotencyKey: string;
    actionId?: string | null;
  }) {
    const kind = generatedArtifactKindSchema.parse(input.kind);
    const plan = artifactWorkflowPlan(kind);
    const sourceVersionIds = [...new Set(input.sourceVersionIds ?? [])].sort();
    const parentArtifactRevisionIds = [
      ...new Set(input.parentArtifactRevisionIds ?? []),
    ].sort();
    const inputDigest = sha256(
      canonicalJson({
        kind,
        title: input.title,
        projectId: input.projectId ?? null,
        sourceVersionIds,
        parentArtifactRevisionIds,
        settings: input.settings ?? null,
        placement: input.placement,
        placementRef: input.placementRef ?? null,
        policyRef: input.policyRef,
      }),
    );
    const artifactId = stableId("gart", input.ownerId, input.idempotencyKey);
    const runId = stableId("awrun", input.ownerId, input.idempotencyKey);
    const transaction = await this.client.transaction("write");
    try {
      const existing = await execute(transaction, {
        sql: `SELECT id, artifactId, inputDigest FROM artifact_workflow_runs WHERE id = ? AND userId = ? LIMIT 1`,
        args: [runId, input.ownerId],
      });
      if (existing.rows[0]) {
        if (String(existing.rows[0].inputDigest) !== inputDigest) {
          throw new Error("Artifact idempotency key was reused with different input");
        }
        await transaction.commit();
        return this.getRun(input.ownerId, runId);
      }
      if (input.projectId) {
        const project = await execute(transaction, {
          sql: `SELECT 1 FROM study_projects WHERE id = ? AND userId = ? AND deletedAt IS NULL LIMIT 1`,
          args: [input.projectId, input.ownerId],
        });
        if (!project.rows[0]) throw new Error("The selected project is unavailable");
      }
      for (const sourceVersionId of sourceVersionIds) {
        const source = await execute(transaction, {
          sql: `
            SELECT 1 FROM content_versions version
            JOIN content_sources source ON source.id = version.sourceId
            WHERE version.id = ? AND source.userId = ? LIMIT 1
          `,
          args: [sourceVersionId, input.ownerId],
        });
        if (!source.rows[0]) throw new Error("An artifact source revision is unavailable");
      }
      for (const parentId of parentArtifactRevisionIds) {
        const parent = await execute(transaction, {
          sql: `SELECT 1 FROM generated_artifact_revisions WHERE id = ? AND userId = ? LIMIT 1`,
          args: [parentId, input.ownerId],
        });
        if (!parent.rows[0]) throw new Error("An artifact parent revision is unavailable");
      }
      const timestamp = now();
      await execute(transaction, {
        sql: `
          INSERT INTO generated_artifacts (
            id, userId, projectId, kind, title, state, revision, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)
        `,
        args: [
          artifactId,
          input.ownerId,
          input.projectId ?? null,
          kind,
          input.title.trim(),
          timestamp,
          timestamp,
        ],
      });
      await execute(transaction, {
        sql: `
          INSERT INTO artifact_workflow_runs (
            id, userId, projectId, artifactId, kind, status, workflowId,
            workflowVersion, inputDigest, placement, placementRef, policyRef,
            actionId, currentStagePosition, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `,
        args: [
          runId,
          input.ownerId,
          input.projectId ?? null,
          artifactId,
          kind,
          plan.id,
          plan.version,
          inputDigest,
          input.placement,
          input.placementRef ?? null,
          input.policyRef,
          input.actionId ?? null,
          timestamp,
          timestamp,
        ],
      });
      for (const [position, stage] of plan.stages.entries()) {
        const stageId = stableId(
          "awstage",
          input.ownerId,
          `${input.idempotencyKey}:${stage.key}`,
        );
        const placement =
          input.placement === "unavailable" && stage.placement === "node"
            ? "unavailable"
            : stage.placement;
        await execute(transaction, {
          sql: `
            INSERT INTO artifact_workflow_stages (
              id, userId, runId, key, position, status, attempt, inputDigest,
              placement, processed, total, unit, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, 'planned', 0, ?, ?, 0, 1, 'stage', ?, ?)
          `,
          args: [
            stageId,
            input.ownerId,
            runId,
            stage.key,
            position,
            stageInputDigest({
              workflowId: plan.id,
              workflowVersion: plan.version,
              stageKey: stage.key,
              artifactKind: kind,
              sourceVersionIds,
              parentArtifactRevisionIds,
              settings: input.settings ?? null,
            }),
            placement,
            timestamp,
            timestamp,
          ],
        });
      }
      await transaction.commit();
      return this.getRun(input.ownerId, runId);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async publishRevision(input: {
    ownerId: string;
    artifactId: string;
    workflowRunId: string;
    parentArtifactRevisionIds?: readonly string[];
    sourceVersionIds?: readonly string[];
    modelRuns?: readonly ModelRunReference[];
    renderer: GeneratedArtifactManifestV1["renderer"];
    output: GeneratedArtifactManifestV1["output"];
    timeline?: VideoTimelineV1;
  }) {
    const transaction = await this.client.transaction("write");
    try {
      const artifactResult = await execute(transaction, {
        sql: `SELECT * FROM generated_artifacts WHERE id = ? AND userId = ? AND state != 'trashed' LIMIT 1`,
        args: [input.artifactId, input.ownerId],
      });
      const artifact = artifactResult.rows[0];
      if (!artifact) throw new Error("Artifact identity was not found");
      const runResult = await execute(transaction, {
        sql: `SELECT * FROM artifact_workflow_runs WHERE id = ? AND artifactId = ? AND userId = ? LIMIT 1`,
        args: [input.workflowRunId, input.artifactId, input.ownerId],
      });
      const run = runResult.rows[0];
      if (!run) throw new Error("Artifact workflow was not found");
      if (input.output.fileId) {
        const file = await execute(transaction, {
          sql: `SELECT byteSize, mimeType FROM files WHERE id = ? AND userId = ? AND status = 'stored' LIMIT 1`,
          args: [input.output.fileId, input.ownerId],
        });
        if (!file.rows[0]) throw new Error("Artifact output file is unavailable");
        if (
          input.output.bytes !== undefined &&
          Number(file.rows[0].byteSize) !== input.output.bytes
        ) {
          throw new Error("Artifact output byte size does not match the owned file");
        }
        if (String(file.rows[0].mimeType) !== input.output.mime) {
          throw new Error("Artifact output MIME type does not match the owned file");
        }
      }
      const revisionResult = await execute(transaction, {
        sql: `SELECT COALESCE(MAX(revision), 0) AS current FROM generated_artifact_revisions WHERE artifactId = ?`,
        args: [input.artifactId],
      });
      const revision = Number(revisionResult.rows[0]?.current ?? 0) + 1;
      const artifactRevisionId = newId("garv");
      const kind = generatedArtifactKindSchema.parse(artifact.kind);
      const parentIds = [...new Set(input.parentArtifactRevisionIds ?? [])].sort();
      const sourceIds = [...new Set(input.sourceVersionIds ?? [])].sort();
      const prepared = createArtifactManifest({
        artifactId: input.artifactId,
        artifactRevisionId,
        revision,
        kind,
        parentArtifactRevisionIds: parentIds,
        sourceVersionIds: sourceIds,
        workflow: {
          id: String(run.workflowId),
          version: Number(run.workflowVersion),
        },
        modelRuns: input.modelRuns,
        renderer: input.renderer,
        output: input.output,
      });
      const timestamp = now();
      await execute(transaction, {
        sql: `
          INSERT INTO generated_artifact_revisions (
            id, artifactId, userId, revision, kind, state, manifestVersion,
            manifestJson, manifestDigest, outputFileId, outputDigest,
            outputMime, byteSize, workflowRunId, createdAt
          ) VALUES (?, ?, ?, ?, ?, 'ready', 1, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          artifactRevisionId,
          input.artifactId,
          input.ownerId,
          revision,
          kind,
          canonicalJson(prepared.manifest),
          prepared.digest,
          input.output.fileId ?? null,
          input.output.digest,
          input.output.mime,
          input.output.bytes ?? null,
          input.workflowRunId,
          timestamp,
        ],
      });
      for (const parentId of parentIds) {
        await execute(transaction, {
          sql: `INSERT INTO artifact_revision_parents (artifactRevisionId, parentArtifactRevisionId) VALUES (?, ?)`,
          args: [artifactRevisionId, parentId],
        });
      }
      for (const sourceVersionId of sourceIds) {
        await execute(transaction, {
          sql: `INSERT INTO artifact_revision_sources (artifactRevisionId, sourceVersionId) VALUES (?, ?)`,
          args: [artifactRevisionId, sourceVersionId],
        });
      }
      if (input.timeline) {
        if (kind !== "video-timeline") {
          throw new Error("Only video-timeline revisions can own a timeline manifest");
        }
        const validated = await validateVideoTimeline({
          ownerId: input.ownerId,
          ownerArtifactRevisionId: artifactRevisionId,
          timeline: input.timeline,
          resolver: this.timelineResolver(transaction),
        });
        await execute(transaction, {
          sql: `
            INSERT INTO video_timeline_manifests (
              artifactRevisionId, userId, schemaVersion, timelineJson,
              digest, durationMs, createdAt
            ) VALUES (?, ?, 1, ?, ?, ?, ?)
          `,
          args: [
            artifactRevisionId,
            input.ownerId,
            canonicalJson(validated.timeline),
            validated.digest,
            validated.durationMs,
            timestamp,
          ],
        });
      }
      await transaction.commit();
      return Object.freeze({
        artifactRevisionId,
        revision,
        manifest: prepared.manifest,
        manifestDigest: prepared.digest,
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async promote(input: {
    ownerId: string;
    artifactId: string;
    artifactRevisionId: string;
    expectedIdentityRevision: number;
  }) {
    const result = await this.client.execute({
      sql: `
        UPDATE generated_artifacts
        SET currentRevisionId = ?, revision = revision + 1, updatedAt = ?
        WHERE id = ? AND userId = ? AND revision = ? AND state = 'active'
      `,
      args: [
        input.artifactRevisionId,
        now(),
        input.artifactId,
        input.ownerId,
        input.expectedIdentityRevision,
      ],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new Error("Artifact current revision changed before promotion");
    }
    return { promoted: true as const };
  }

  async setState(input: {
    ownerId: string;
    artifactId: string;
    state: "active" | "archived" | "trashed";
    expectedIdentityRevision: number;
  }) {
    const result = await this.client.execute({
      sql: `
        UPDATE generated_artifacts SET state = ?, revision = revision + 1, updatedAt = ?
        WHERE id = ? AND userId = ? AND revision = ?
      `,
      args: [
        input.state,
        now(),
        input.artifactId,
        input.ownerId,
        input.expectedIdentityRevision,
      ],
    });
    if (Number(result.rowsAffected) !== 1) throw new Error("Artifact changed elsewhere");
    return { state: input.state };
  }

  async getManifest(ownerId: string, artifactRevisionId: string) {
    const result = await this.client.execute({
      sql: `SELECT manifestJson, manifestDigest FROM generated_artifact_revisions WHERE id = ? AND userId = ? LIMIT 1`,
      args: [artifactRevisionId, ownerId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("Artifact revision was not found");
    return Object.freeze({
      manifest: generatedArtifactManifestV1Schema.parse(jsonValue(row.manifestJson)),
      digest: String(row.manifestDigest),
    });
  }

  async getRun(ownerId: string, runId: string) {
    const runResult = await this.client.execute({
      sql: `SELECT * FROM artifact_workflow_runs WHERE id = ? AND userId = ? LIMIT 1`,
      args: [runId, ownerId],
    });
    const run = runResult.rows[0];
    if (!run) throw new Error("Artifact workflow was not found");
    const stages = await this.client.execute({
      sql: `SELECT * FROM artifact_workflow_stages WHERE runId = ? AND userId = ? ORDER BY position`,
      args: [runId, ownerId],
    });
    return Object.freeze({
      id: String(run.id),
      artifactId: String(run.artifactId),
      kind: generatedArtifactKindSchema.parse(run.kind),
      status: String(run.status),
      workflowId: String(run.workflowId),
      workflowVersion: Number(run.workflowVersion),
      inputDigest: String(run.inputDigest),
      placement: String(run.placement),
      placementRef: string(run.placementRef),
      reasonCode: string(run.reasonCode),
      stages: stages.rows.map((stage) => ({
        id: String(stage.id),
        key: String(stage.key),
        position: Number(stage.position),
        status: String(stage.status),
        attempt: Number(stage.attempt),
        inputDigest: String(stage.inputDigest),
        placement: String(stage.placement),
        processed: Number(stage.processed),
        total: Number(stage.total),
        unit: String(stage.unit),
        message: string(stage.message),
        reasonCode: string(stage.reasonCode),
        outputArtifactRevisionId: string(stage.outputArtifactRevisionId),
        jobId: string(stage.jobId),
      })),
    });
  }

  async list(ownerId: string, projectId?: string | null) {
    const result = await this.client.execute({
      sql: `
        SELECT artifact.*, revision.manifestDigest, revision.outputMime,
          revision.createdAt AS revisionCreatedAt
        FROM generated_artifacts artifact
        LEFT JOIN generated_artifact_revisions revision
          ON revision.id = artifact.currentRevisionId
        WHERE artifact.userId = ? AND artifact.state != 'trashed'
          AND (? IS NULL OR artifact.projectId = ?)
        ORDER BY artifact.updatedAt DESC, artifact.id
      `,
      args: [ownerId, projectId ?? null, projectId ?? null],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      projectId: string(row.projectId),
      kind: generatedArtifactKindSchema.parse(row.kind),
      title: String(row.title),
      state: String(row.state),
      currentRevisionId: string(row.currentRevisionId),
      identityRevision: Number(row.revision),
      manifestDigest: string(row.manifestDigest),
      outputMime: string(row.outputMime),
    }));
  }

  legacyManifest(input: LegacyDocumentArtifactSnapshot) {
    return manifestFromLegacyDocumentArtifact(input);
  }

  private timelineResolver(target: SqlClient | Transaction): TimelineReferenceResolver {
    return {
      artifactRevision: async (ownerId, id) => {
        const result = await execute(target, {
          sql: `SELECT id, userId, outputDigest, kind FROM generated_artifact_revisions WHERE id = ? AND userId = ? LIMIT 1`,
          args: [id, ownerId],
        });
        const row = result.rows[0];
        return row
          ? {
              id: String(row.id),
              ownerId: String(row.userId),
              digest: String(row.outputDigest),
              kind: String(row.kind),
            }
          : null;
      },
      citation: async (ownerId, id) => {
        const result = await execute(target, {
          sql: `SELECT * FROM content_version_references WHERE id = ? AND userId = ? AND ownerKind = 'artifact-revision' LIMIT 1`,
          args: [id, ownerId],
        });
        const row = result.rows[0];
        return row
          ? {
              id: String(row.id),
              ownerId: String(row.userId),
              ownerKind: "artifact-revision" as const,
              ownerIdWithinKind: String(row.ownerId),
              sourceVersionId: String(row.sourceVersionId),
              chunkId: string(row.chunkId),
              referenceKey: String(row.referenceKey),
            }
          : null;
      },
    };
  }
}

export const coreArtifactGraphStore = new CoreArtifactGraphStore();

