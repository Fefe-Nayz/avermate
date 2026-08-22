import type { Client } from "@libsql/client";
import {
  generatedArtifactKindSchema,
  videoTimelineV1Schema,
  type GeneratedArtifactKind,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import { coreJobRuntime } from "../jobs/core-job-runtime-store";
import type { JobRuntime } from "../jobs/job-runtime";
import { NonRetryableJobError } from "../lib/jobs";
import { canonicalJson, jsonValue, sha256 } from "../search/values";
import {
  CoreArtifactGraphStore,
  coreArtifactGraphStore,
} from "./artifact-graph";
import {
  ArtifactWorkflowStageInputError,
  type ArtifactWorkflowExternalStageKey,
  type ArtifactWorkflowStageExecutor,
} from "./artifact-stage-executor";
import { artifactWorkflowPlan, stageInputDigest } from "./workflow";
import { CoreNodeArtifactWorkflowStageExecutor } from "../node/artifact-stage-executor";

export const ARTIFACT_WORKFLOW_STAGE_JOB_KIND =
  "artifact.workflow.stage.v1" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const workflowPayloadSchema = z.strictObject({
  version: z.literal(1),
  ownerId: z.string().min(1),
  runId: z.string().min(1),
  artifactId: z.string().min(1),
  kind: generatedArtifactKindSchema,
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  inputDigest: sha256Schema,
  sourceVersionIds: z.array(z.string().min(1)).max(5_000),
  parentArtifactRevisionIds: z.array(z.string().min(1)).max(100),
  settings: z.record(z.string(), z.unknown()),
  stageId: z.string().min(1),
  stageKey: z.string().min(1),
  stagePosition: z.number().int().nonnegative(),
  stageAttempt: z.number().int().nonnegative(),
  stageInputDigest: sha256Schema,
  executionDeadline: z.iso.datetime({ offset: true }),
});

type WorkflowPayload = z.infer<typeof workflowPayloadSchema>;
type SqlClient = Pick<Client, "execute">;
type WorkflowJobs = Pick<JobRuntime, "enqueue">;
type WorkflowGraph = Pick<
  CoreArtifactGraphStore,
  "getRun" | "publishRevision"
>;

export type ArtifactWorkflowDispatchInput = {
  ownerId: string;
  runId: string;
  artifactId: string;
  kind: GeneratedArtifactKind;
  inputDigest: string;
  sourceVersionIds?: readonly string[];
  parentArtifactRevisionIds?: readonly string[];
  settings?: Record<string, unknown>;
};

function seconds() {
  return Math.floor(Date.now() / 1_000);
}

function value(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Restart-safe bridge between a persisted artifact workflow and the durable
 * Core job queue. Only exact, owner-bound stage inputs are placed on the queue;
 * unsupported/unattested placements fail closed before a worker is invoked.
 */
export class ArtifactWorkflowDispatcher {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly jobs: WorkflowJobs = coreJobRuntime,
    private readonly graph: WorkflowGraph = coreArtifactGraphStore,
    private readonly externalStages?: ArtifactWorkflowStageExecutor,
  ) {}

  /** Re-arm an approval/retry from the immutable payload of an earlier stage. */
  async resume(ownerId: string, runId: string) {
    const result = await this.client.execute({
      sql: `SELECT payload FROM jobs
        WHERE userId = ? AND kind = ?
          AND json_extract(payload, '$.runId') = ?
        ORDER BY createdAt DESC LIMIT 1`,
      args: [ownerId, ARTIFACT_WORKFLOW_STAGE_JOB_KIND, runId],
    });
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        "The workflow has no durable execution input to resume",
      );
    }
    const payload = workflowPayloadSchema.parse(jsonValue(row.payload));
    if (payload.ownerId !== ownerId || payload.runId !== runId) {
      throw new Error("Artifact workflow resume binding changed");
    }
    return this.dispatch({
      ownerId: payload.ownerId,
      runId: payload.runId,
      artifactId: payload.artifactId,
      kind: payload.kind,
      inputDigest: payload.inputDigest,
      sourceVersionIds: payload.sourceVersionIds,
      parentArtifactRevisionIds: payload.parentArtifactRevisionIds,
      settings: payload.settings,
    });
  }

  async dispatch(raw: ArtifactWorkflowDispatchInput) {
    const input = this.normalize(raw);
    const runResult = await this.client.execute({
      sql: `
        SELECT artifactId, kind, status, workflowId, workflowVersion,
          inputDigest, cancelRequestedAt
        FROM artifact_workflow_runs
        WHERE id = ? AND userId = ? LIMIT 1
      `,
      args: [input.runId, input.ownerId],
    });
    const run = runResult.rows[0];
    if (!run) throw new Error("Artifact workflow was not found");
    if (
      String(run.artifactId) !== input.artifactId ||
      String(run.kind) !== input.kind ||
      String(run.inputDigest) !== input.inputDigest
    ) {
      throw new Error("Artifact workflow dispatch binding changed");
    }
    if (
      ["completed", "failed", "cancelled", "superseded"].includes(
        String(run.status),
      )
    ) {
      return this.graph.getRun(input.ownerId, input.runId);
    }
    if (run.cancelRequestedAt !== null) {
      await this.cancelUnstarted(input.ownerId, input.runId);
      return this.graph.getRun(input.ownerId, input.runId);
    }

    const stageResult = await this.client.execute({
      sql: `
        SELECT * FROM artifact_workflow_stages
        WHERE runId = ? AND userId = ?
          AND status IN ('planned', 'queued', 'running', 'awaiting_approval')
        ORDER BY position LIMIT 1
      `,
      args: [input.runId, input.ownerId],
    });
    const stage = stageResult.rows[0];
    if (!stage) {
      const unfinished = await this.client.execute({
        sql: `SELECT 1 FROM artifact_workflow_stages
          WHERE runId = ? AND userId = ? AND status != 'completed' LIMIT 1`,
        args: [input.runId, input.ownerId],
      });
      if (!unfinished.rows[0]) {
        const timestamp = seconds();
        await this.client.execute({
          sql: `UPDATE artifact_workflow_runs
            SET status = 'completed', currentStagePosition = (
              SELECT COUNT(*) FROM artifact_workflow_stages
              WHERE runId = ? AND userId = ?
            ), completedAt = COALESCE(completedAt, ?), updatedAt = ?
            WHERE id = ? AND userId = ?
              AND status IN ('planned', 'queued', 'running')`,
          args: [
            input.runId,
            input.ownerId,
            timestamp,
            timestamp,
            input.runId,
            input.ownerId,
          ],
        });
      }
      return this.graph.getRun(input.ownerId, input.runId);
    }

    const position = Number(stage.position);
    const plan = artifactWorkflowPlan(input.kind);
    const planned = plan.stages[position];
    if (!planned || planned.key !== String(stage.key)) {
      throw new Error("Artifact workflow stage no longer matches its plan");
    }
    const expectedStageDigest = stageInputDigest({
      workflowId: String(run.workflowId),
      workflowVersion: Number(run.workflowVersion),
      stageKey: String(stage.key),
      artifactKind: input.kind,
      sourceVersionIds: input.sourceVersionIds,
      parentArtifactRevisionIds: input.parentArtifactRevisionIds,
      settings: input.settings,
    });
    if (expectedStageDigest !== String(stage.inputDigest)) {
      throw new Error("Artifact workflow stage input digest changed");
    }
    if (String(stage.placement) === "unavailable") {
      await this.failStage({
        ownerId: input.ownerId,
        runId: input.runId,
        stageId: String(stage.id),
        reasonCode: "placement_unavailable",
        safeMessage: "Required execution placement is unavailable",
      });
      return this.graph.getRun(input.ownerId, input.runId);
    }
    if (String(stage.status) === "running") {
      return this.graph.getRun(input.ownerId, input.runId);
    }
    if (planned.approvalRequired) {
      if (String(stage.status) === "planned") {
        const timestamp = seconds();
        await this.client.execute({
          sql: `UPDATE artifact_workflow_stages
            SET status = 'awaiting_approval',
              message = 'Approval required before execution', updatedAt = ?
            WHERE id = ? AND runId = ? AND userId = ? AND status = 'planned'`,
          args: [timestamp, stage.id, input.runId, input.ownerId],
        });
        await this.client.execute({
          sql: `UPDATE artifact_workflow_runs
            SET status = 'awaiting_approval', currentStagePosition = ?, updatedAt = ?
            WHERE id = ? AND userId = ?
              AND status IN ('planned', 'queued', 'running')`,
          args: [position, timestamp, input.runId, input.ownerId],
        });
      }
      if (String(stage.status) !== "queued") {
        return this.graph.getRun(input.ownerId, input.runId);
      }
    }
    if (String(stage.status) === "queued" && stage.jobId !== null) {
      return this.graph.getRun(input.ownerId, input.runId);
    }

    const payload = workflowPayloadSchema.parse({
      version: 1,
      ...input,
      workflowId: String(run.workflowId),
      workflowVersion: Number(run.workflowVersion),
      stageId: String(stage.id),
      stageKey: String(stage.key),
      stagePosition: position,
      stageAttempt: Number(stage.attempt),
      stageInputDigest: String(stage.inputDigest),
      executionDeadline: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    });
    const job = await this.jobs.enqueue({
      ownerId: input.ownerId,
      kind: ARTIFACT_WORKFLOW_STAGE_JOB_KIND,
      payload,
      payloadVersion: 1,
      idempotencyKey: [
        input.runId,
        payload.stageId,
        payload.stageAttempt,
        payload.stageInputDigest,
      ].join(":"),
      maxAttempts: 3,
    });
    const timestamp = seconds();
    const queued = await this.client.execute({
      sql: `UPDATE artifact_workflow_stages
        SET status = 'queued', jobId = ?, message = 'Queued for durable execution',
          reasonCode = NULL, safeError = NULL, updatedAt = ?
        WHERE id = ? AND runId = ? AND userId = ?
          AND status IN ('planned', 'queued')
          AND (jobId IS NULL OR jobId = ?)`,
      args: [
        job.id,
        timestamp,
        payload.stageId,
        input.runId,
        input.ownerId,
        job.id,
      ],
    });
    if (Number(queued.rowsAffected) !== 1) {
      const current = await this.client.execute({
        sql: `SELECT status, jobId FROM artifact_workflow_stages
          WHERE id = ? AND runId = ? AND userId = ? LIMIT 1`,
        args: [payload.stageId, input.runId, input.ownerId],
      });
      if (
        !current.rows[0] ||
        String(current.rows[0].status) !== "running" ||
        String(current.rows[0].jobId) !== job.id
      ) {
        throw new Error("Artifact workflow stage changed before dispatch");
      }
    }
    await this.client.execute({
      sql: `UPDATE artifact_workflow_runs
        SET status = 'queued', currentStagePosition = ?, updatedAt = ?
        WHERE id = ? AND userId = ?
          AND status IN ('planned', 'queued', 'running', 'awaiting_approval')`,
      args: [position, timestamp, input.runId, input.ownerId],
    });
    return this.graph.getRun(input.ownerId, input.runId);
  }

  async execute(
    raw: unknown,
    context: {
      jobId: string;
      attempts: number;
      maxAttempts: number;
      signal?: AbortSignal;
    },
  ) {
    const payload = workflowPayloadSchema.parse(raw);
    try {
      context.signal?.throwIfAborted();
      const claimed = await this.client.execute({
        sql: `UPDATE artifact_workflow_stages
          SET status = 'running', startedAt = COALESCE(startedAt, ?),
            message = 'Executing durable stage', updatedAt = ?
          WHERE id = ? AND runId = ? AND userId = ?
            AND inputDigest = ? AND attempt = ? AND jobId = ?
            AND status IN ('queued', 'running')`,
        args: [
          seconds(),
          seconds(),
          payload.stageId,
          payload.runId,
          payload.ownerId,
          payload.stageInputDigest,
          payload.stageAttempt,
          context.jobId,
        ],
      });
      if (Number(claimed.rowsAffected) !== 1) {
        const terminal = await this.client.execute({
          sql: `SELECT status, outputArtifactRevisionId
            FROM artifact_workflow_stages
            WHERE id = ? AND runId = ? AND userId = ? LIMIT 1`,
          args: [payload.stageId, payload.runId, payload.ownerId],
        });
        if (String(terminal.rows[0]?.status) === "completed") {
          return {
            replayed: true as const,
            outputArtifactRevisionId: value(
              terminal.rows[0]?.outputArtifactRevisionId,
            ),
          };
        }
        throw new ArtifactWorkflowStageInputError(
          "The workflow stage is no longer executable",
        );
      }
      const timestamp = seconds();
      await this.client.execute({
        sql: `UPDATE artifact_workflow_runs
          SET status = 'running', currentStagePosition = ?,
            startedAt = COALESCE(startedAt, ?), updatedAt = ?
          WHERE id = ? AND userId = ?
            AND status IN ('planned', 'queued', 'running', 'awaiting_approval')`,
        args: [
          payload.stagePosition,
          timestamp,
          timestamp,
          payload.runId,
          payload.ownerId,
        ],
      });

      const outputArtifactRevisionId = await this.executeStage(
        payload,
        context.signal,
      );
      context.signal?.throwIfAborted();
      const completedAt = seconds();
      const completed = await this.client.execute({
        sql: `UPDATE artifact_workflow_stages
          SET status = 'completed', processed = total,
            outputArtifactRevisionId = ?, message = 'Stage completed',
            completedAt = ?, updatedAt = ?
          WHERE id = ? AND runId = ? AND userId = ?
            AND status = 'running' AND jobId = ? AND inputDigest = ?`,
        args: [
          outputArtifactRevisionId,
          completedAt,
          completedAt,
          payload.stageId,
          payload.runId,
          payload.ownerId,
          context.jobId,
          payload.stageInputDigest,
        ],
      });
      if (Number(completed.rowsAffected) !== 1) {
        throw new Error("Artifact workflow stage lost its completion fence");
      }
      const run = await this.dispatch({
        ownerId: payload.ownerId,
        runId: payload.runId,
        artifactId: payload.artifactId,
        kind: payload.kind,
        inputDigest: payload.inputDigest,
        sourceVersionIds: payload.sourceVersionIds,
        parentArtifactRevisionIds: payload.parentArtifactRevisionIds,
        settings: payload.settings,
      });
      return {
        completed: true as const,
        outputArtifactRevisionId,
        workflowStatus: run.status,
      };
    } catch (error) {
      const nonRetryable = error instanceof ArtifactWorkflowStageInputError;
      if (nonRetryable || context.attempts >= context.maxAttempts) {
        await this.failStage({
          ownerId: payload.ownerId,
          runId: payload.runId,
          stageId: payload.stageId,
          reasonCode: nonRetryable ? "unsupported_content" : "internal_failure",
          safeMessage: nonRetryable
            ? error.safeMessage
            : "Artifact execution failed after bounded retries",
        });
      }
      if (nonRetryable) {
        throw new NonRetryableJobError(error.safeMessage, { cause: error });
      }
      throw error;
    }
  }

  private async executeStage(
    payload: WorkflowPayload,
    signal?: AbortSignal,
  ): Promise<string | null> {
    signal?.throwIfAborted();
    switch (payload.stageKey) {
      case "resolve-citations":
        await this.verifyOwnedReferences(payload);
        return null;
      case "validate-timeline": {
        const timeline = videoTimelineV1Schema.safeParse(
          payload.settings.timeline,
        );
        if (!timeline.success) {
          throw new ArtifactWorkflowStageInputError(
            "A valid, versioned video timeline is required",
            { cause: timeline.error },
          );
        }
        return null;
      }
      case "publish-timeline": {
        const parsed = videoTimelineV1Schema.safeParse(
          payload.settings.timeline,
        );
        if (!parsed.success) {
          throw new ArtifactWorkflowStageInputError(
            "A valid, versioned video timeline is required",
            { cause: parsed.error },
          );
        }
        const digest = sha256(canonicalJson(parsed.data));
        const existing = await this.client.execute({
          sql: `SELECT id FROM generated_artifact_revisions
            WHERE workflowRunId = ? AND userId = ? AND outputDigest = ?
            ORDER BY revision LIMIT 1`,
          args: [payload.runId, payload.ownerId, digest],
        });
        if (existing.rows[0]) return String(existing.rows[0].id);
        const published = await this.graph.publishRevision({
          ownerId: payload.ownerId,
          artifactId: payload.artifactId,
          workflowRunId: payload.runId,
          parentArtifactRevisionIds: payload.parentArtifactRevisionIds,
          sourceVersionIds: payload.sourceVersionIds,
          renderer: {
            profile: "timeline.manifest.v1",
            imageDigest: null,
            toolVersions: { canonicalizer: "1" },
            reproducibility: "full",
          },
          output: {
            digest,
            mime: "application/vnd.avermate.video-timeline+json",
          },
          timeline: parsed.data,
        });
        return published.artifactRevisionId;
      }
      case "generate":
      case "render-video":
      case "compose-thumbnail":
      case "adopt-output":
        if (!this.externalStages) {
          throw new ArtifactWorkflowStageInputError(
            `No conforming executor is available for stage ${payload.stageKey}`,
          );
        }
        return this.externalStages.execute(
          {
            ...payload,
            stageKey: payload.stageKey as ArtifactWorkflowExternalStageKey,
          },
          signal,
        );
      default:
        throw new ArtifactWorkflowStageInputError(
          `No conforming executor is available for stage ${payload.stageKey}`,
        );
    }
  }

  private async verifyOwnedReferences(payload: WorkflowPayload) {
    for (const sourceVersionId of payload.sourceVersionIds) {
      const source = await this.client.execute({
        sql: `SELECT 1 FROM content_versions version
          JOIN content_sources source ON source.id = version.sourceId
          WHERE version.id = ? AND source.userId = ? LIMIT 1`,
        args: [sourceVersionId, payload.ownerId],
      });
      if (!source.rows[0]) {
        throw new ArtifactWorkflowStageInputError(
          "An artifact source revision is unavailable",
        );
      }
    }
    for (const revisionId of payload.parentArtifactRevisionIds) {
      const revision = await this.client.execute({
        sql: `SELECT 1 FROM generated_artifact_revisions
          WHERE id = ? AND userId = ? AND state = 'ready' LIMIT 1`,
        args: [revisionId, payload.ownerId],
      });
      if (!revision.rows[0]) {
        throw new ArtifactWorkflowStageInputError(
          "An artifact parent revision is unavailable",
        );
      }
    }
  }

  private normalize(input: ArtifactWorkflowDispatchInput) {
    return Object.freeze({
      ownerId: input.ownerId.trim(),
      runId: input.runId.trim(),
      artifactId: input.artifactId.trim(),
      kind: generatedArtifactKindSchema.parse(input.kind),
      inputDigest: sha256Schema.parse(input.inputDigest),
      sourceVersionIds: Object.freeze(
        [...new Set(input.sourceVersionIds ?? [])].sort(),
      ),
      parentArtifactRevisionIds: Object.freeze(
        [...new Set(input.parentArtifactRevisionIds ?? [])].sort(),
      ),
      settings: Object.freeze({ ...(input.settings ?? {}) }),
    });
  }

  private async cancelUnstarted(ownerId: string, runId: string) {
    const timestamp = seconds();
    await this.client.execute({
      sql: `UPDATE artifact_workflow_stages
        SET status = 'cancelled', reasonCode = 'cancelled',
          message = 'Cancelled before execution', completedAt = ?, updatedAt = ?
        WHERE runId = ? AND userId = ? AND status IN ('planned', 'queued')`,
      args: [timestamp, timestamp, runId, ownerId],
    });
    await this.client.execute({
      sql: `UPDATE artifact_workflow_runs
        SET status = 'cancelled', reasonCode = 'cancelled',
          completedAt = ?, updatedAt = ?
        WHERE id = ? AND userId = ?
          AND status IN ('planned', 'queued', 'awaiting_approval')`,
      args: [timestamp, timestamp, runId, ownerId],
    });
  }

  private async failStage(input: {
    ownerId: string;
    runId: string;
    stageId: string;
    reasonCode: "placement_unavailable" | "unsupported_content" | "internal_failure";
    safeMessage: string;
  }) {
    const timestamp = seconds();
    await this.client.execute({
      sql: `UPDATE artifact_workflow_stages
        SET status = 'failed', reasonCode = ?, safeError = ?, message = ?,
          completedAt = COALESCE(completedAt, ?), updatedAt = ?
        WHERE id = ? AND runId = ? AND userId = ?
          AND status IN ('planned', 'queued', 'running', 'awaiting_approval')`,
      args: [
        input.reasonCode,
        input.safeMessage.slice(0, 1_000),
        input.safeMessage.slice(0, 1_000),
        timestamp,
        timestamp,
        input.stageId,
        input.runId,
        input.ownerId,
      ],
    });
    await this.client.execute({
      sql: `UPDATE artifact_workflow_runs
        SET status = 'failed', reasonCode = ?, safeError = ?,
          completedAt = COALESCE(completedAt, ?), updatedAt = ?
        WHERE id = ? AND userId = ?
          AND status IN ('planned', 'queued', 'running', 'awaiting_approval')`,
      args: [
        input.reasonCode,
        input.safeMessage.slice(0, 1_000),
        timestamp,
        timestamp,
        input.runId,
        input.ownerId,
      ],
    });
  }
}

export const artifactWorkflowDispatcher = new ArtifactWorkflowDispatcher(
  db.$client,
  coreJobRuntime,
  coreArtifactGraphStore,
  new CoreNodeArtifactWorkflowStageExecutor(),
);

export async function dispatchPlannedArtifactWorkflow(
  input: ArtifactWorkflowDispatchInput,
) {
  return artifactWorkflowDispatcher.dispatch(input);
}

export async function runArtifactWorkflowStageJob(
  payload: unknown,
  context: {
    jobId: string;
    attempts: number;
    maxAttempts: number;
    signal?: AbortSignal;
  },
) {
  return artifactWorkflowDispatcher.execute(payload, context);
}
