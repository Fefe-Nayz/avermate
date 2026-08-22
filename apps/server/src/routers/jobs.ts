import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { jobRuntimeMetadata, jobs } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireJob } from "../lib/ownership";

function publicJobResult(kind: string, result: unknown): unknown {
  if (kind !== "export.documentPptx") return result;
  if (!result || typeof result !== "object") return null;
  const source = result as Record<string, unknown>;
  return {
    ...(typeof source.fileId === "string" ? { fileId: source.fileId } : {}),
    ...(typeof source.byteSize === "number"
      ? { byteSize: source.byteSize }
      : {}),
    ...(typeof source.revision === "number"
      ? { revision: source.revision }
      : {}),
  };
}

function publicJob(row: typeof jobs.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAt: row.runAt,
    result: publicJobResult(row.kind, row.result),
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Only work explicitly started by a user and safe to abandon is cancellable. */
export const USER_CANCELLABLE_JOB_KINDS = new Set([
  "ingest.link",
  "ocr.document",
  "grade-copy.analyze",
  "export.documentPptx",
  "corpus.reembedSpace",
  "corpus.produceDerivatives",
  "corpus.evaluateRetrieval",
]);

export const jobsRouter = {
  get: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .handler(async ({ context, input }) =>
      publicJob(await requireJob(context.session.user.id, input.jobId)),
    ),

  list: protectedProcedure
    .input(
      z.object({
        kinds: z.array(z.string().trim().min(1)).max(50).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .handler(async ({ context, input }) => {
      const rows = await db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, context.session.user.id),
            input.kinds?.length ? inArray(jobs.kind, input.kinds) : undefined,
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(input.limit);
      return rows.map(publicJob);
    }),

  cancel: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const existing = await requireJob(context.session.user.id, input.jobId);
      if (!USER_CANCELLABLE_JOB_KINDS.has(existing.kind)) {
        badRequest("This internal job cannot be cancelled");
      }
      if (existing.status === "running") {
        const now = new Date();
        await db
          .insert(jobRuntimeMetadata)
          .values({
            jobId: existing.id,
            stage: "running",
            cancellation: "requested",
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: jobRuntimeMetadata.jobId,
            set: { cancellation: "requested", updatedAt: now },
          });
        return { ...publicJob(existing), cancellationRequested: true };
      }
      if (existing.status !== "queued") {
        badRequest("Only queued or running work can be cancelled");
      }
      const [cancelled] = await db
        .update(jobs)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(jobs.id, input.jobId), eq(jobs.status, "queued")))
        .returning();
      if (!cancelled)
        badRequest("The job started before it could be cancelled");
      return publicJob(cancelled);
    }),
};
