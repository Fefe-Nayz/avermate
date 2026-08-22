import { describe, expect, test } from "bun:test";
import {
  StoreBackedJobRuntime,
  type DurableJobRuntimeStore,
  type JobRuntimeEvent,
  type JobRuntimeRecord,
} from "./job-runtime";

function fakeStore(): DurableJobRuntimeStore {
  let record: JobRuntimeRecord | null = null;
  const events: JobRuntimeEvent[] = [];
  return {
    durability: "durable",
    async enqueue(input) {
      record ??= {
        id: "job-1",
        ownerId: input.ownerId,
        kind: input.kind,
        status: "queued",
        stage: "queued",
        payloadVersion: input.payloadVersion,
        attempts: 0,
        maxAttempts: input.maxAttempts,
        cancellation: "none",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
      };
      return record;
    },
    async inspect() {
      return record;
    },
    async appendEvent(input) {
      // SAFETY: the store adds the sole missing discriminated-union field.
      const event = {
        ...input.event,
        sequence: events.length + 1,
      } as JobRuntimeEvent;
      events.push(event);
      return event;
    },
    async replayEvents(input) {
      return events
        .filter((event) => event.sequence > input.afterSequence)
        .slice(0, input.limit);
    },
    async *streamEvents(input) {
      for (const event of events) {
        if (event.sequence > input.afterSequence) yield event;
      }
    },
    async verifyLease() {
      return false;
    },
    async requestCancellation() {
      if (!record) throw new Error("missing");
      record = {
        ...record,
        status: "cancelled",
        stage: "terminal",
        cancellation: "acknowledged",
      };
      return record;
    },
  };
}

describe("store-backed job runtime", () => {
  test("provides ordered progress replay and ownership fencing", async () => {
    const runtime = new StoreBackedJobRuntime(fakeStore());
    const job = await runtime.enqueue({
      ownerId: "owner",
      kind: "sandbox.execute",
      idempotencyKey: "request-1",
    });
    await runtime.publish("owner", job.id, {
      type: "progress",
      at: "2026-08-22T00:00:01.000Z",
      current: 1,
      total: 2,
      unit: "stages",
      message: "capturing workspace",
    });
    await runtime.publish("owner", job.id, {
      type: "progress",
      at: "2026-08-22T00:00:02.000Z",
      current: 2,
      total: 2,
      unit: "stages",
      message: "done",
    });
    expect(
      (await runtime.replay({ ownerId: "owner", jobId: job.id })).map(
        (e) => e.sequence,
      ),
    ).toEqual([1, 2]);
    const streamed: number[] = [];
    for await (const event of runtime.events({
      ownerId: "owner",
      jobId: job.id,
    })) {
      streamed.push(event.sequence);
    }
    expect(streamed).toEqual([1, 2]);
    expect(runtime.inspect("attacker", job.id)).rejects.toThrow("not found");
  });

  test("lost leases fence result adoption", async () => {
    const runtime = new StoreBackedJobRuntime(fakeStore());
    const job = await runtime.enqueue({
      ownerId: "owner",
      kind: "sandbox.execute",
      idempotencyKey: "request-fenced",
    });
    expect(
      runtime.assertResultAdoptionFence({
        jobId: job.id,
        ownerId: "owner",
        attempt: 1,
        leaseOwner: "worker",
        leaseToken: "lease-token",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toThrow("cannot adopt");
  });

  test("routes cancellation through the durable store", async () => {
    const runtime = new StoreBackedJobRuntime(fakeStore());
    const job = await runtime.enqueue({
      ownerId: "owner",
      kind: "sandbox.execute",
      idempotencyKey: "request-1",
    });
    expect(
      await runtime.cancel({
        ownerId: "owner",
        jobId: job.id,
        reason: "user request",
      }),
    ).toMatchObject({ status: "cancelled" });
  });
});
