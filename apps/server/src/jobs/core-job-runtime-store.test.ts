import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { createCorpusTestDatabase } from "../search/test-helpers";
import { CoreDurableJobRuntimeStore } from "./core-job-runtime-store";
import { StoreBackedJobRuntime } from "./job-runtime";

let client: Client;
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

beforeAll(async () => {
  client = await createCorpusTestDatabase();
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS job_runtime_metadata (
      jobId text PRIMARY KEY NOT NULL,
      stage text DEFAULT 'queued' NOT NULL,
      cancellation text DEFAULT 'none' NOT NULL,
      leaseToken text,
      lastEventSequence integer DEFAULT 0 NOT NULL,
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL,
      FOREIGN KEY (jobId) REFERENCES jobs(id)
        ON UPDATE CASCADE ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS job_runtime_events (
      id text PRIMARY KEY NOT NULL,
      jobId text NOT NULL,
      userId text NOT NULL,
      sequence integer NOT NULL,
      type text NOT NULL,
      eventJson text NOT NULL,
      createdAt integer NOT NULL,
      FOREIGN KEY (jobId) REFERENCES jobs(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS job_runtime_events_job_sequence_unique
      ON job_runtime_events (jobId, sequence);
    CREATE INDEX IF NOT EXISTS job_runtime_events_user_job_sequence_idx
      ON job_runtime_events (userId, jobId, sequence);
  `);
}, databaseHookTimeout);

afterAll(() => client.close(), databaseHookTimeout);

describe("CoreDurableJobRuntimeStore", () => {
  test("persists idempotent jobs, ordered events and lease adoption fences", async () => {
    const store = new CoreDurableJobRuntimeStore(client);
    const runtime = new StoreBackedJobRuntime(store);
    const request = {
      ownerId: "corpus-user-a",
      kind: "sandbox.execute",
      payload: { profile: "latex" },
      idempotencyKey: "runtime-store-1",
    };
    const job = await runtime.enqueue(request);
    expect((await runtime.enqueue(request)).id).toBe(job.id);
    await expect(
      runtime.enqueue({ ...request, payload: { profile: "python-data" } }),
    ).rejects.toThrow("different request");
    await expect(runtime.inspect("corpus-user-b", job.id)).rejects.toThrow(
      "not found",
    );
    expect(
      (await runtime.replay({ ownerId: request.ownerId, jobId: job.id })).map(
        (event) => event.sequence,
      ),
    ).toEqual([1]);

    const claimed = await store.claimNext({ workerId: "worker-a" });
    expect(claimed?.record).toMatchObject({
      id: job.id,
      status: "running",
      stage: "leased",
      attempts: 1,
    });
    expect(await store.verifyLease(claimed!.fence)).toBe(true);
    await runtime.assertResultAdoptionFence(claimed!.fence);
    await runtime.publish(request.ownerId, job.id, {
      type: "state",
      at: new Date().toISOString(),
      status: "running",
      stage: "running",
      attempt: 1,
    });
    await runtime.publish(request.ownerId, job.id, {
      type: "progress",
      at: new Date().toISOString(),
      current: 1,
      total: 1,
      unit: "artifact",
      message: "validated",
    });
    await runtime.publish(request.ownerId, job.id, {
      type: "terminal",
      at: new Date().toISOString(),
      status: "succeeded",
      publicResult: { artifactId: "artifact-1" },
    });

    const afterRestart = new StoreBackedJobRuntime(
      new CoreDurableJobRuntimeStore(client),
    );
    expect(await afterRestart.inspect(request.ownerId, job.id)).toMatchObject({
      status: "succeeded",
      stage: "terminal",
    });
    const replay = await afterRestart.replay({
      ownerId: request.ownerId,
      jobId: job.id,
    });
    expect(replay.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    const streamed: number[] = [];
    for await (const event of afterRestart.events({
      ownerId: request.ownerId,
      jobId: job.id,
    })) {
      streamed.push(event.sequence);
    }
    expect(streamed).toEqual([1, 2, 3, 4, 5]);
    await expect(
      afterRestart.assertResultAdoptionFence(claimed!.fence),
    ).rejects.toThrow("cannot adopt");
  });

  test("persists running cancellation and requires the active lease to acknowledge", async () => {
    const store = new CoreDurableJobRuntimeStore(client);
    const runtime = new StoreBackedJobRuntime(store);
    const job = await runtime.enqueue({
      ownerId: "corpus-user-a",
      kind: "sandbox.execute",
      payload: { profile: "media" },
      idempotencyKey: "runtime-store-cancel",
    });
    const claimed = await store.claimNext({ workerId: "worker-cancel" });
    expect(claimed?.record.id).toBe(job.id);
    expect(
      await runtime.cancel({
        ownerId: "corpus-user-a",
        jobId: job.id,
        reason: "user request",
      }),
    ).toMatchObject({ status: "running", cancellation: "requested" });
    await expect(
      store.acknowledgeCancellation({
        fence: { ...claimed!.fence, leaseToken: "wrong" },
        reason: "cancelled",
      }),
    ).rejects.toThrow("lease was lost");
    expect(
      await store.acknowledgeCancellation({
        fence: claimed!.fence,
        reason: "cancelled by worker",
      }),
    ).toMatchObject({
      status: "cancelled",
      stage: "terminal",
      cancellation: "acknowledged",
    });
    const events = await runtime.replay({
      ownerId: "corpus-user-a",
      jobId: job.id,
    });
    expect(events.map((event) => event.type)).toEqual([
      "state",
      "state",
      "cancellation",
      "terminal",
    ]);
  });

  test("cancels queued work without ever leasing it", async () => {
    const store = new CoreDurableJobRuntimeStore(client);
    const runtime = new StoreBackedJobRuntime(store);
    const job = await runtime.enqueue({
      ownerId: "corpus-user-a",
      kind: "sandbox.execute",
      idempotencyKey: "runtime-store-queued-cancel",
    });
    expect(
      await runtime.cancel({
        ownerId: "corpus-user-a",
        jobId: job.id,
        reason: "changed my mind",
      }),
    ).toMatchObject({
      status: "cancelled",
      cancellation: "acknowledged",
    });
    expect(await store.claimNext({ workerId: "worker-never" })).toBeNull();
  });
});
