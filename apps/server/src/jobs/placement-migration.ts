import { z } from "zod";
import { enqueueJob } from "../lib/jobs";
import { runPlacementMigration } from "../node/placement-migration";

export const PLACEMENT_MIGRATION_JOB_KIND = "node.placementMigration";

export const placementMigrationJobPayloadSchema = z
  .object({
    ownerId: z.string().trim().min(1).max(256),
    migrationId: z.string().trim().min(1).max(256),
  })
  .strict();

type Enqueue = typeof enqueueJob;

export function enqueuePlacementMigrationJob(
  input: z.infer<typeof placementMigrationJobPayloadSchema>,
  options: { enqueue?: Enqueue } = {},
) {
  const payload = placementMigrationJobPayloadSchema.parse(input);
  return (options.enqueue ?? enqueueJob)({
    kind: PLACEMENT_MIGRATION_JOB_KIND,
    payload,
    payloadVersion: 1,
    userId: payload.ownerId,
    idempotencyKey: payload.migrationId,
    maxAttempts: 6,
    newAttemptAfterTerminal: true,
  });
}

export function runPlacementMigrationJob(
  payload: unknown,
  options: {
    signal?: AbortSignal;
    run?: typeof runPlacementMigration;
  } = {},
) {
  const parsed = placementMigrationJobPayloadSchema.parse(payload);
  return (options.run ?? runPlacementMigration)(
    parsed.ownerId,
    parsed.migrationId,
    { signal: options.signal },
  );
}
