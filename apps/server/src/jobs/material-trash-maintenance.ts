import { z } from "zod";
import { enqueueJob } from "../lib/jobs";
import {
  MATERIAL_TRASH_PURGE_BATCH_SIZE,
  materialTrashPurgeCursorSchema,
  purgeExpiredMaterialTrash,
  type MaterialsOperationsRouterDependencies,
} from "../routers/materials/operations";

export const PURGE_MATERIAL_TRASH_JOB_KIND = "maintenance.purgeMaterialTrash";
export const MATERIAL_TRASH_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const MATERIAL_TRASH_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60_000;

const scheduledForSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !Number.isNaN(new Date(value).getTime()),
    "scheduledFor must be a valid ISO date",
  );

export const materialTrashMaintenancePayloadSchema = z
  .object({
    scheduledFor: scheduledForSchema,
    cutoff: z.string().datetime().optional(),
    cursor: materialTrashPurgeCursorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cursor && !value.cutoff) {
      context.addIssue({
        code: "custom",
        message: "A material trash continuation cursor requires a cutoff",
        path: ["cutoff"],
      });
    }
  });

type Enqueue = typeof enqueueJob;

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function enqueueMaterialTrashMaintenanceJob(
  runAt = new Date(),
  options: { enqueue?: Enqueue } = {},
) {
  return (options.enqueue ?? enqueueJob)({
    kind: PURGE_MATERIAL_TRASH_JOB_KIND,
    payload: { scheduledFor: runAt.toISOString() },
    userId: null,
    idempotencyKey: utcDateKey(runAt),
    runAt,
    maxAttempts: 3,
  });
}

function continuationKey(
  scheduledFor: string,
  cutoff: string,
  cursor: z.infer<typeof materialTrashPurgeCursorSchema>,
) {
  const bucket = utcDateKey(new Date(scheduledFor));
  return `${bucket}:cutoff:${cutoff}:after:${cursor.kind}:${cursor.deletedAt}:${cursor.id}`;
}

async function enqueueContinuation(
  input: {
    scheduledFor: string;
    cutoff: string;
    cursor: z.infer<typeof materialTrashPurgeCursorSchema>;
    runAt: Date;
  },
  enqueue: Enqueue,
) {
  const jobInput = {
    kind: PURGE_MATERIAL_TRASH_JOB_KIND,
    payload: {
      scheduledFor: input.scheduledFor,
      cutoff: input.cutoff,
      cursor: input.cursor,
    },
    userId: null,
    idempotencyKey: continuationKey(
      input.scheduledFor,
      input.cutoff,
      input.cursor,
    ),
    runAt: input.runAt,
    maxAttempts: 3,
  } as const;
  const job = await enqueue(jobInput);
  if (job.status !== "failed" && job.status !== "cancelled") return job;
  return enqueue({ ...jobInput, newAttemptAfterTerminal: true });
}

/**
 * Runs exactly one bounded batch. The daily successor is persisted before the
 * root scan; an immediate, cursor-keyed continuation is persisted afterwards
 * only when unseen targets remain, allowing other runnable jobs between lots.
 */
export async function runMaterialTrashMaintenanceJob(
  payload: unknown,
  options: MaterialsOperationsRouterDependencies & {
    now?: () => Date;
    enqueue?: Enqueue;
    batchSize?: number;
  } = {},
) {
  const parsed = materialTrashMaintenancePayloadSchema.parse(payload);
  const now = options.now?.() ?? new Date();
  const enqueue = options.enqueue ?? options.enqueueJob ?? enqueueJob;
  const nextDaily = parsed.cutoff
    ? null
    : await enqueueMaterialTrashMaintenanceJob(
        new Date(now.getTime() + MATERIAL_TRASH_MAINTENANCE_INTERVAL_MS),
        { enqueue },
      );
  const cutoff = parsed.cutoff
    ? new Date(parsed.cutoff)
    : new Date(now.getTime() - MATERIAL_TRASH_RETENTION_MS);
  const result = await purgeExpiredMaterialTrash(cutoff, {
    deleteFile: options.deleteFile,
    deleteFilePreview: options.deleteFilePreview,
    enqueueJob: enqueue,
    batchSize: options.batchSize ?? MATERIAL_TRASH_PURGE_BATCH_SIZE,
    cursor: parsed.cursor ?? null,
  });

  let continuation = null;
  if (result.hasMore) {
    if (!result.cursor) {
      throw new Error(
        "Material trash purge has more rows but no continuation cursor",
      );
    }
    continuation = await enqueueContinuation(
      {
        scheduledFor: parsed.scheduledFor,
        cutoff: cutoff.toISOString(),
        cursor: result.cursor,
        runAt: now,
      },
      enqueue,
    );
  }
  return {
    ...result,
    nextDailyJobId: nextDaily?.id ?? null,
    continuationJobId: continuation?.id ?? null,
  };
}
