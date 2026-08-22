import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { materialArtifacts, type MaterialArtifactKind } from "../db/schema";
import { newId } from "../lib/id";
import type { UserJobExecutionAuthority } from "./job-authority";
import { supersededJobExecution } from "./job-authority";

type GeneratedArtifactKind = Extract<
  MaterialArtifactKind,
  "ocr-markdown" | "media-transcript"
>;

export interface MaterialArtifactGeneration {
  artifactId: string;
  documentId: string;
  kind: GeneratedArtifactKind;
  userId: string;
  runToken: string;
  job?: UserJobExecutionAuthority;
}

export interface GeneratedArtifactSegment {
  text: string;
  locatorJson: string;
  contentHash: string;
}

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

const ACTIVE_JOB_SQL = `"id" = ? AND "kind" = ? AND "userId" = ?
  AND "status" = 'running' AND "attempts" = ? AND "lockedBy" = ?
  AND "lockedUntil" IS NOT NULL AND "lockedUntil" > ?`;

function activeJobArgs(job: UserJobExecutionAuthority, now: Date) {
  return [
    job.jobId,
    job.kind,
    job.userId,
    job.attempt,
    job.leaseOwner,
    seconds(now),
  ];
}

/** Atomically move one owned projection to this exact queue generation. */
export async function claimMaterialArtifactGeneration(input: {
  documentId: string;
  kind: GeneratedArtifactKind;
  userId: string;
  runToken: string;
  job?: UserJobExecutionAuthority;
  now?: Date;
}): Promise<MaterialArtifactGeneration> {
  const now = input.now ?? new Date();
  const artifactId = newId("mart");
  if (input.job) {
    const authorityArgs = activeJobArgs(input.job, now);
    const claimed = await db.$client.execute({
      sql: `INSERT INTO "material_artifacts"
          ("id", "documentId", "kind", "status", "content",
           "metaVersion", "metaJson", "error", "runId", "userId",
           "createdAt", "updatedAt")
        SELECT ?, ?, ?, 'pending', NULL, 1, NULL, NULL, ?, ?, ?, ?
        FROM "jobs" WHERE ${ACTIVE_JOB_SQL}
        ON CONFLICT("documentId", "kind") DO UPDATE SET
          "status" = 'pending', "content" = NULL, "metaVersion" = 1,
          "metaJson" = NULL, "error" = NULL,
          "runId" = excluded."runId", "userId" = excluded."userId",
          "updatedAt" = excluded."updatedAt"
        WHERE EXISTS (SELECT 1 FROM "jobs" WHERE ${ACTIVE_JOB_SQL})`,
      args: [
        artifactId,
        input.documentId,
        input.kind,
        input.runToken,
        input.userId,
        seconds(now),
        seconds(now),
        ...authorityArgs,
        ...authorityArgs,
      ],
    });
    if (claimed.rowsAffected !== 1) throw supersededJobExecution();
  } else {
    await db
      .insert(materialArtifacts)
      .values({
        id: artifactId,
        documentId: input.documentId,
        kind: input.kind,
        status: "pending",
        content: null,
        metaVersion: 1,
        metaJson: null,
        error: null,
        runId: input.runToken,
        userId: input.userId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [materialArtifacts.documentId, materialArtifacts.kind],
        set: {
          status: "pending",
          content: null,
          metaVersion: 1,
          metaJson: null,
          error: null,
          runId: input.runToken,
          userId: input.userId,
          updatedAt: now,
        },
      });
  }

  const [artifact] = await db
    .select({ id: materialArtifacts.id })
    .from(materialArtifacts)
    .where(
      and(
        eq(materialArtifacts.documentId, input.documentId),
        eq(materialArtifacts.kind, input.kind),
        eq(materialArtifacts.userId, input.userId),
        eq(materialArtifacts.runId, input.runToken),
      ),
    )
    .limit(1);
  if (!artifact) throw supersededJobExecution();
  return {
    artifactId: artifact.id,
    documentId: input.documentId,
    kind: input.kind,
    userId: input.userId,
    runToken: input.runToken,
    ...(input.job ? { job: input.job } : {}),
  };
}

/** Publish segments and terminal content as one fenced SQLite transaction. */
export async function publishMaterialArtifactGeneration(input: {
  generation: MaterialArtifactGeneration;
  content: string;
  metaJson: string;
  segments: readonly GeneratedArtifactSegment[];
  now?: Date;
}) {
  const { generation } = input;
  const now = input.now ?? new Date();
  const artifactArgs = [
    generation.artifactId,
    generation.documentId,
    generation.kind,
    generation.userId,
    generation.runToken,
  ];
  const jobPredicate = generation.job
    ? ` AND EXISTS (SELECT 1 FROM "jobs" WHERE ${ACTIVE_JOB_SQL})`
    : "";
  const jobArgs = generation.job ? activeJobArgs(generation.job, now) : [];

  await db.$client.batch(
    [
      {
        sql: `DELETE FROM "material_artifact_segments" WHERE "artifactId" =
          (SELECT "id" FROM "material_artifacts" WHERE "id" = ?
            AND "documentId" = ? AND "kind" = ? AND "userId" = ?
            AND "runId" = ? LIMIT 1)`,
        args: artifactArgs,
      },
      ...input.segments.map((segment, ordinal) => ({
        sql: `INSERT INTO "material_artifact_segments"
            ("id", "artifactId", "ordinal", "text", "locatorJson", "contentHash")
          SELECT ?, "id", ?, ?, ?, ? FROM "material_artifacts"
          WHERE "id" = ? AND "documentId" = ? AND "kind" = ?
            AND "userId" = ? AND "runId" = ? LIMIT 1`,
        args: [
          newId("maseg"),
          ordinal,
          segment.text,
          segment.locatorJson,
          segment.contentHash,
          ...artifactArgs,
        ],
      })),
      {
        sql: `UPDATE "material_artifacts" SET "status" = 'ready',
            "content" = ?, "metaVersion" = 1, "metaJson" = ?,
            "error" = NULL, "updatedAt" = ?
          WHERE "id" = ? AND "documentId" = ? AND "kind" = ?
            AND "userId" = ? AND "runId" = ? AND "status" = 'pending'
            ${jobPredicate}`,
        args: [
          input.content,
          input.metaJson,
          seconds(now),
          ...artifactArgs,
          ...jobArgs,
        ],
      },
      {
        sql: `INSERT INTO "jobs"
            ("id", "kind", "payloadVersion", "status", "attempts",
             "maxAttempts", "runAt", "userId", "createdAt", "updatedAt")
          SELECT NULL, '__material_artifact_publish_guard__', 1, 'failed',
            0, 1, ?, ?, ?, ? WHERE changes() = 0`,
        args: [seconds(now), generation.userId, seconds(now), seconds(now)],
      },
    ],
    "write",
  );
}

/** A failure is advisory unless this exact generation still owns the row. */
export async function failMaterialArtifactGeneration(input: {
  generation: MaterialArtifactGeneration;
  error: string;
  now?: Date;
}) {
  const { generation } = input;
  const now = input.now ?? new Date();
  const jobPredicate = generation.job
    ? ` AND EXISTS (SELECT 1 FROM "jobs" WHERE ${ACTIVE_JOB_SQL})`
    : "";
  const jobArgs = generation.job ? activeJobArgs(generation.job, now) : [];
  return db.$client.execute({
    sql: `UPDATE "material_artifacts" SET "status" = 'failed',
        "content" = NULL, "metaJson" = NULL, "error" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "documentId" = ? AND "kind" = ?
        AND "userId" = ? AND "runId" = ? AND "status" = 'pending'
        ${jobPredicate}`,
    args: [
      input.error,
      seconds(now),
      generation.artifactId,
      generation.documentId,
      generation.kind,
      generation.userId,
      generation.runToken,
      ...jobArgs,
    ],
  });
}
