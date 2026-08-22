import { describe, expect, test } from "bun:test";
import {
  enqueuePlacementMigrationJob,
  PLACEMENT_MIGRATION_JOB_KIND,
  runPlacementMigrationJob,
} from "./placement-migration";

describe("placement migration durable job", () => {
  test("enqueues one owner-scoped idempotent ledger row", async () => {
    const calls: unknown[] = [];
    const job = await enqueuePlacementMigrationJob(
      { ownerId: "owner-a", migrationId: "migration-a" },
      {
        enqueue: (async (input: unknown) => {
          calls.push(input);
          return { id: "job-a", status: "queued" };
        }) as never,
      },
    );

    expect(job.id).toBe("job-a");
    expect(job.status).toBe("queued");
    expect(calls).toEqual([
      {
        kind: PLACEMENT_MIGRATION_JOB_KIND,
        payload: { ownerId: "owner-a", migrationId: "migration-a" },
        payloadVersion: 1,
        userId: "owner-a",
        idempotencyKey: "migration-a",
        maxAttempts: 6,
        newAttemptAfterTerminal: true,
      },
    ]);
  });

  test("validates the payload and forwards cancellation to the runner", async () => {
    const controller = new AbortController();
    const calls: unknown[] = [];
    const migration = {
      id: "migration-a",
      accountId: "owner-a",
      resourceKind: "storage" as const,
      resourceId: "placement-a",
      sourcePlacement: { kind: "core" as const, providerId: "core-a" },
      destinationPlacement: { kind: "core" as const, providerId: "core-b" },
      state: "source-retained" as const,
      sourceDigest: null,
      destinationDigest: null,
      copiedBytes: 0,
      idempotencyKey: "placement-a",
      safeErrorCode: null,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    };
    const result = await runPlacementMigrationJob(
      { ownerId: "owner-a", migrationId: "migration-a" },
      {
        signal: controller.signal,
        run: (async (...args: unknown[]) => {
          calls.push(args);
          return migration;
        }) as never,
      },
    );

    expect(result).toEqual(migration);
    expect(calls).toEqual([
      ["owner-a", "migration-a", { signal: controller.signal }],
    ]);
    expect(() =>
      runPlacementMigrationJob({
        ownerId: "owner-a",
        migrationId: "migration-a",
        unexpected: true,
      }),
    ).toThrow();
  });
});
