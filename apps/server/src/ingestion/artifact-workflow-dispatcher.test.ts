import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreArtifactGraphStore } from "./artifact-graph";
import { stageInputDigest } from "./workflow";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";

const ARTIFACT_WORKFLOW_STAGE_JOB_KIND = "artifact.workflow.stage.v1";

const clients: Client[] = [];
const directory = mkdtempSync(join(tmpdir(), "avermate-artifact-dispatch-"));

async function fixture() {
  const { ArtifactWorkflowDispatcher } = await import(
    "./artifact-workflow-dispatcher"
  );
  const client = createClient({
    url: `file:${join(directory, `${crypto.randomUUID()}.db`)}`,
  });
  clients.push(client);
  await client.batch(
    [
      `CREATE TABLE artifact_workflow_runs (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, artifactId TEXT NOT NULL,
        kind TEXT NOT NULL, status TEXT NOT NULL, workflowId TEXT NOT NULL,
        workflowVersion INTEGER NOT NULL, inputDigest TEXT NOT NULL,
        cancelRequestedAt INTEGER, currentStagePosition INTEGER NOT NULL,
        reasonCode TEXT, safeError TEXT, startedAt INTEGER, completedAt INTEGER,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      )`,
      `CREATE TABLE artifact_workflow_stages (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, runId TEXT NOT NULL,
        key TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL,
        attempt INTEGER NOT NULL, inputDigest TEXT NOT NULL,
        outputArtifactRevisionId TEXT, jobId TEXT, placement TEXT NOT NULL,
        processed INTEGER NOT NULL, total INTEGER NOT NULL, unit TEXT NOT NULL,
        message TEXT, reasonCode TEXT, safeError TEXT, startedAt INTEGER,
        completedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      )`,
      `CREATE TABLE jobs (
        id TEXT PRIMARY KEY, userId TEXT, kind TEXT NOT NULL, payload TEXT,
        createdAt INTEGER NOT NULL
      )`,
      `CREATE TABLE content_versions (id TEXT PRIMARY KEY, sourceId TEXT NOT NULL)`,
      `CREATE TABLE content_sources (id TEXT PRIMARY KEY, userId TEXT NOT NULL)`,
      `CREATE TABLE generated_artifact_revisions (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, state TEXT NOT NULL,
        workflowRunId TEXT, outputDigest TEXT, revision INTEGER
      )`,
    ],
    "write",
  );
  const inputDigest = "a".repeat(64);
  const base = {
    workflowId: "artifact.video-timeline.v1",
    workflowVersion: 1,
    artifactKind: "video-timeline" as const,
    sourceVersionIds: [] as string[],
    parentArtifactRevisionIds: [] as string[],
    settings: { instructions: "fixture" },
  };
  await client.execute({
    sql: `INSERT INTO artifact_workflow_runs VALUES
      ('run-1','owner-1','artifact-1','video-timeline','planned',?,1,?,NULL,0,
       NULL,NULL,NULL,NULL,1,1)`,
    args: [base.workflowId, inputDigest],
  });
  for (const [position, key] of [
    "resolve-citations",
    "publish-timeline",
  ].entries()) {
    await client.execute({
      sql: `INSERT INTO artifact_workflow_stages VALUES
        (?, 'owner-1','run-1',?,?, 'planned',0,?,NULL,NULL,'core',0,1,'stage',
         NULL,NULL,NULL,NULL,NULL,1,1)`,
      args: [
        `stage-${position + 1}`,
        key,
        position,
        stageInputDigest({ ...base, stageKey: key }),
      ],
    });
  }
  const enqueued: Array<{ id: string; input: Record<string, unknown> }> = [];
  const jobs = {
    async enqueue(input: Record<string, unknown>) {
      const id = `job-${enqueued.length + 1}`;
      enqueued.push({ id, input });
      await client.execute({
        sql: `INSERT INTO jobs (id,userId,kind,payload,createdAt)
          VALUES (?,?,?,?,?)`,
        args: [
          id,
          String(input.ownerId),
          String(input.kind),
          JSON.stringify(input.payload),
          Date.now() + enqueued.length,
        ],
      });
      return {
        id,
        ownerId: String(input.ownerId),
        kind: String(input.kind),
        status: "queued" as const,
        stage: "queued" as const,
        payloadVersion: 1,
        attempts: 0,
        maxAttempts: 3,
        cancellation: "none" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
  };
  const graph = {
    async getRun(ownerId: string, runId: string) {
      const run = await client.execute({
        sql: `SELECT * FROM artifact_workflow_runs WHERE id = ? AND userId = ?`,
        args: [runId, ownerId],
      });
      if (!run.rows[0]) throw new Error("not found");
      const stages = await client.execute({
        sql: `SELECT * FROM artifact_workflow_stages
          WHERE runId = ? AND userId = ? ORDER BY position`,
        args: [runId, ownerId],
      });
      return {
        id: runId,
        artifactId: String(run.rows[0].artifactId),
        kind: "video-timeline" as const,
        status: String(run.rows[0].status),
        workflowId: String(run.rows[0].workflowId),
        workflowVersion: 1,
        inputDigest,
        placement: "core",
        placementRef: null,
        reasonCode: null,
        safeError: null,
        createdAt: new Date(1_000).toISOString(),
        updatedAt: new Date(1_000).toISOString(),
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
          message: stage.message === null ? null : String(stage.message),
          reasonCode: null,
          safeError: null,
          outputArtifactRevisionId: null,
          jobId: stage.jobId === null ? null : String(stage.jobId),
        })),
      };
    },
    async publishRevision() {
      throw new Error("publish is outside this dispatch fixture");
    },
  };
  return {
    client,
    enqueued,
    input: {
      ownerId: "owner-1",
      runId: "run-1",
      artifactId: "artifact-1",
      kind: "video-timeline" as const,
      inputDigest,
      sourceVersionIds: [],
      parentArtifactRevisionIds: [],
      settings: base.settings,
    },
    dispatcher: new ArtifactWorkflowDispatcher(
      client,
      jobs,
      graph as unknown as CoreArtifactGraphStore,
    ),
  };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

afterAll(() => {
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {
    // Windows can retain a libSQL handle briefly under the OS temp directory.
  }
});

describe("artifact workflow durable dispatch", () => {
  test("queues enabled stages idempotently and advances only after completion", async () => {
    const { client, dispatcher, enqueued, input } = await fixture();
    const queued = await dispatcher.dispatch(input);
    expect(queued.status).toBe("queued");
    expect(queued.stages[0]?.status).toBe("queued");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.input.kind).toBe(ARTIFACT_WORKFLOW_STAGE_JOB_KIND);

    await dispatcher.dispatch(input);
    expect(enqueued).toHaveLength(1);

    await dispatcher.execute(enqueued[0]?.input.payload, {
      jobId: "job-1",
      attempts: 1,
      maxAttempts: 3,
    });
    expect(enqueued).toHaveLength(2);
    const stages = await client.execute(
      `SELECT status, jobId FROM artifact_workflow_stages ORDER BY position`,
    );
    expect(stages.rows.map((row) => [row.status, row.jobId])).toEqual([
      ["completed", "job-1"],
      ["queued", "job-2"],
    ]);
  });

  test("rejects cross-owner dispatch without creating a job", async () => {
    const { dispatcher, enqueued, input } = await fixture();
    await expect(
      dispatcher.dispatch({ ...input, ownerId: "owner-2" }),
    ).rejects.toThrow("not found");
    expect(enqueued).toHaveLength(0);
  });
});
