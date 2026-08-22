import type { Client } from "@libsql/client";
import type { ArtifactWorkflowStatus } from "@avermate/agent-contracts";
import { db } from "../db";
import { coreJobRuntime } from "../jobs/core-job-runtime-store";
import type { JobRuntime } from "../jobs/job-runtime";
import { assertWorkflowTransition, retryDisposition } from "./workflow";

type SqlClient = Pick<Client, "execute">;

function now() {
  return Math.floor(Date.now() / 1_000);
}

export class ArtifactWorkflowStore {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly jobs: JobRuntime = coreJobRuntime,
  ) {}

  async cancel(input: { ownerId: string; runId: string; reason?: string }) {
    const run = await this.client.execute({
      sql: `SELECT status FROM artifact_workflow_runs WHERE id = ? AND userId = ? LIMIT 1`,
      args: [input.runId, input.ownerId],
    });
    const row = run.rows[0];
    if (!row) throw new Error("Artifact workflow was not found");
    const status = String(row.status) as ArtifactWorkflowStatus;
    if (["completed", "failed", "cancelled", "superseded"].includes(status)) {
      return { status, requested: false as const };
    }
    const activeJobs = await this.client.execute({
      sql: `SELECT id, jobId FROM artifact_workflow_stages WHERE runId = ? AND userId = ? AND jobId IS NOT NULL AND status IN ('queued', 'running')`,
      args: [input.runId, input.ownerId],
    });
    for (const stage of activeJobs.rows) {
      await this.jobs.cancel({
        ownerId: input.ownerId,
        jobId: String(stage.jobId),
        reason: (input.reason ?? "User cancelled the artifact workflow").slice(0, 1_000),
      });
    }
    const timestamp = now();
    await this.client.execute({
      sql: `
        UPDATE artifact_workflow_runs
        SET cancelRequestedAt = ?,
          status = CASE
            WHEN EXISTS (
              SELECT 1 FROM artifact_workflow_stages stage
              WHERE stage.runId = artifact_workflow_runs.id AND stage.status = 'running'
            ) THEN status ELSE 'cancelled' END,
          completedAt = CASE
            WHEN EXISTS (
              SELECT 1 FROM artifact_workflow_stages stage
              WHERE stage.runId = artifact_workflow_runs.id AND stage.status = 'running'
            ) THEN completedAt ELSE ? END,
          updatedAt = ?
        WHERE id = ? AND userId = ?
      `,
      args: [timestamp, timestamp, timestamp, input.runId, input.ownerId],
    });
    await this.client.execute({
      sql: `
        UPDATE artifact_workflow_stages
        SET status = 'cancelled', completedAt = ?, updatedAt = ?,
          reasonCode = 'cancelled', message = 'Cancelled before execution'
        WHERE runId = ? AND userId = ? AND status IN ('planned', 'queued', 'awaiting_approval')
      `,
      args: [timestamp, timestamp, input.runId, input.ownerId],
    });
    return { status: "cancelled" as const, requested: true as const };
  }

  async approve(input: { ownerId: string; runId: string; stageId: string }) {
    const result = await this.client.execute({
      sql: `
        UPDATE artifact_workflow_stages
        SET status = CASE WHEN placement = 'unavailable' THEN status ELSE 'queued' END,
          message = CASE WHEN placement = 'unavailable'
            THEN 'Required execution placement is unavailable'
            ELSE 'Approved and ready for dispatch' END,
          reasonCode = CASE WHEN placement = 'unavailable'
            THEN 'placement_unavailable' ELSE NULL END,
          updatedAt = ?
        WHERE id = ? AND runId = ? AND userId = ? AND status = 'awaiting_approval'
      `,
      args: [now(), input.stageId, input.runId, input.ownerId],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new Error("The workflow stage is no longer awaiting approval");
    }
    return { approved: true as const };
  }

  async retry(input: { ownerId: string; runId: string; stageId: string }) {
    const result = await this.client.execute({
      sql: `SELECT * FROM artifact_workflow_stages WHERE id = ? AND runId = ? AND userId = ? LIMIT 1`,
      args: [input.stageId, input.runId, input.ownerId],
    });
    const stage = result.rows[0];
    if (!stage) throw new Error("Artifact workflow stage was not found");
    const disposition = retryDisposition({
      status: String(stage.status) as ArtifactWorkflowStatus,
      attempt: Number(stage.attempt),
      reasonCode:
        stage.reasonCode === null
          ? null
          : (String(stage.reasonCode) as Parameters<typeof retryDisposition>[0]["reasonCode"]),
      inputDigest: String(stage.inputDigest),
      previousCompletedInputDigest:
        String(stage.status) === "completed" ? String(stage.inputDigest) : null,
    });
    if (!disposition.retry) return disposition;
    const timestamp = now();
    await this.client.execute({
      sql: `
        UPDATE artifact_workflow_stages
        SET status = CASE WHEN placement = 'unavailable' THEN 'failed' ELSE 'planned' END,
          attempt = ?, jobId = NULL, reasonCode = CASE WHEN placement = 'unavailable'
            THEN 'placement_unavailable' ELSE NULL END,
          safeError = NULL, message = CASE WHEN placement = 'unavailable'
            THEN 'Required execution placement is unavailable' ELSE 'Ready to retry' END,
          processed = 0, startedAt = NULL, completedAt = NULL, updatedAt = ?
        WHERE id = ? AND runId = ? AND userId = ? AND attempt = ?
      `,
      args: [
        disposition.nextAttempt,
        timestamp,
        input.stageId,
        input.runId,
        input.ownerId,
        Number(stage.attempt),
      ],
    });
    await this.client.execute({
      sql: `
        UPDATE artifact_workflow_runs SET status = 'planned', safeError = NULL,
          reasonCode = NULL, completedAt = NULL, updatedAt = ?
        WHERE id = ? AND userId = ? AND status IN ('failed', 'cancelled')
      `,
      args: [timestamp, input.runId, input.ownerId],
    });
    return disposition;
  }

  async transitionStage(input: {
    ownerId: string;
    stageId: string;
    from: ArtifactWorkflowStatus;
    to: ArtifactWorkflowStatus;
    jobId?: string | null;
  }) {
    assertWorkflowTransition(input.from, input.to);
    const result = await this.client.execute({
      sql: `UPDATE artifact_workflow_stages SET status = ?, jobId = ?, updatedAt = ? WHERE id = ? AND userId = ? AND status = ?`,
      args: [
        input.to,
        input.jobId ?? null,
        now(),
        input.stageId,
        input.ownerId,
        input.from,
      ],
    });
    if (Number(result.rowsAffected) !== 1) throw new Error("Workflow stage state changed");
  }
}

export const artifactWorkflowStore = new ArtifactWorkflowStore();

