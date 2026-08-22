export type JobRuntimeStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobRuntimeStage =
  | "queued"
  | "leased"
  | "provisioning"
  | "running"
  | "snapshotting"
  | "adopting"
  | "terminal";

export interface JobExecutionFence {
  readonly jobId: string;
  readonly ownerId: string;
  readonly attempt: number;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
}

export interface JobRuntimeRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: string;
  readonly status: JobRuntimeStatus;
  readonly stage: JobRuntimeStage;
  readonly payloadVersion: number;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly cancellation: "none" | "requested" | "acknowledged";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type JobRuntimeEvent =
  | {
      readonly sequence: number;
      readonly type: "state";
      readonly at: string;
      readonly status: JobRuntimeStatus;
      readonly stage: JobRuntimeStage;
      readonly attempt: number;
    }
  | {
      readonly sequence: number;
      readonly type: "progress";
      readonly at: string;
      readonly current: number;
      readonly total: number;
      readonly unit: string;
      readonly message?: string;
    }
  | {
      readonly sequence: number;
      readonly type: "log";
      readonly at: string;
      readonly level: "info" | "warning" | "error";
      readonly message: string;
    }
  | {
      readonly sequence: number;
      readonly type: "heartbeat";
      readonly at: string;
      readonly attempt: number;
      readonly leaseOwner: string;
      readonly leaseExpiresAt: string;
    }
  | {
      readonly sequence: number;
      readonly type: "cancellation";
      readonly at: string;
      readonly state: "requested" | "acknowledged";
      readonly safeReason: string;
    }
  | {
      readonly sequence: number;
      readonly type: "resource-usage";
      readonly at: string;
      readonly cpuMillis: number;
      readonly peakMemoryBytes: number;
      readonly networkBytes: number;
      readonly outputBytes: number;
    }
  | {
      readonly sequence: number;
      readonly type: "terminal";
      readonly at: string;
      readonly status: "succeeded" | "failed" | "cancelled";
      readonly publicResult?: unknown;
      readonly error?: string;
    };

export type JobRuntimeEventInput = JobRuntimeEvent extends infer Event
  ? Event extends JobRuntimeEvent
    ? Omit<Event, "sequence">
    : never
  : never;

export interface DurableJobRuntimeStore {
  readonly durability: "durable";
  enqueue(input: {
    ownerId: string;
    kind: string;
    payload: unknown;
    payloadVersion: number;
    idempotencyKey: string;
    maxAttempts: number;
  }): Promise<JobRuntimeRecord>;
  inspect(jobId: string): Promise<JobRuntimeRecord | null>;
  appendEvent(input: {
    jobId: string;
    ownerId: string;
    event: JobRuntimeEventInput;
  }): Promise<JobRuntimeEvent>;
  replayEvents(input: {
    jobId: string;
    ownerId: string;
    afterSequence: number;
    limit: number;
  }): Promise<readonly JobRuntimeEvent[]>;
  streamEvents(input: {
    jobId: string;
    ownerId: string;
    afterSequence: number;
    signal?: AbortSignal;
  }): AsyncIterable<JobRuntimeEvent>;
  verifyLease(fence: JobExecutionFence): Promise<boolean>;
  requestCancellation(input: {
    jobId: string;
    ownerId: string;
    reason: string;
  }): Promise<JobRuntimeRecord>;
}

export interface JobRuntime {
  enqueue(input: {
    ownerId: string;
    kind: string;
    payload?: unknown;
    payloadVersion?: number;
    idempotencyKey: string;
    maxAttempts?: number;
  }): Promise<JobRuntimeRecord>;
  inspect(ownerId: string, jobId: string): Promise<JobRuntimeRecord>;
  publish(
    ownerId: string,
    jobId: string,
    event: JobRuntimeEventInput,
  ): Promise<JobRuntimeEvent>;
  replay(input: {
    ownerId: string;
    jobId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<readonly JobRuntimeEvent[]>;
  events(input: {
    ownerId: string;
    jobId: string;
    afterSequence?: number;
    signal?: AbortSignal;
  }): AsyncIterable<JobRuntimeEvent>;
  assertResultAdoptionFence(fence: JobExecutionFence): Promise<void>;
  cancel(input: {
    ownerId: string;
    jobId: string;
    reason: string;
  }): Promise<JobRuntimeRecord>;
}

/**
 * Stable boundary over the current durable queue. The store is injected so the
 * runtime cannot silently fall back to process memory when progress/event
 * persistence has not been migrated yet.
 */
export class StoreBackedJobRuntime implements JobRuntime {
  constructor(private readonly store: DurableJobRuntimeStore) {
    if (store.durability !== "durable") {
      throw new Error("JobRuntime requires a durable store.");
    }
  }

  enqueue(input: {
    ownerId: string;
    kind: string;
    payload?: unknown;
    payloadVersion?: number;
    idempotencyKey: string;
    maxAttempts?: number;
  }): Promise<JobRuntimeRecord> {
    const ownerId = nonEmpty(input.ownerId, "ownerId");
    const kind = nonEmpty(input.kind, "kind");
    const idempotencyKey = nonEmpty(input.idempotencyKey, "idempotencyKey");
    const payloadVersion = input.payloadVersion ?? 1;
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(payloadVersion) || payloadVersion < 1) {
      throw new Error("payloadVersion must be a positive integer.");
    }
    if (
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 100
    ) {
      throw new Error("maxAttempts must be an integer between 1 and 100.");
    }
    return this.store.enqueue({
      ownerId,
      kind,
      payload: input.payload ?? null,
      payloadVersion,
      idempotencyKey,
      maxAttempts,
    });
  }

  async inspect(ownerId: string, jobId: string): Promise<JobRuntimeRecord> {
    const record = await this.store.inspect(nonEmpty(jobId, "jobId"));
    if (!record || record.ownerId !== ownerId)
      throw new Error("Job not found.");
    return record;
  }

  async publish(
    ownerId: string,
    jobId: string,
    event: JobRuntimeEventInput,
  ): Promise<JobRuntimeEvent> {
    const record = await this.inspect(ownerId, jobId);
    if (isTerminal(record.status))
      throw new Error("Terminal jobs cannot publish more events.");
    validateJobEvent(event);
    return this.store.appendEvent({ jobId: record.id, ownerId, event });
  }

  async replay(input: {
    ownerId: string;
    jobId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<readonly JobRuntimeEvent[]> {
    const record = await this.inspect(input.ownerId, input.jobId);
    const afterSequence = input.afterSequence ?? 0;
    const limit = input.limit ?? 100;
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new Error("afterSequence must be a non-negative integer.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("Replay limit must be between 1 and 1000.");
    }
    const events = await this.store.replayEvents({
      jobId: record.id,
      ownerId: input.ownerId,
      afterSequence,
      limit,
    });
    let previous = afterSequence;
    for (const event of events) {
      if (event.sequence <= previous)
        throw new Error("Job event replay is not strictly ordered.");
      validateJobEvent(event);
      previous = event.sequence;
    }
    return events;
  }

  async *events(input: {
    ownerId: string;
    jobId: string;
    afterSequence?: number;
    signal?: AbortSignal;
  }): AsyncIterable<JobRuntimeEvent> {
    const record = await this.inspect(input.ownerId, input.jobId);
    let previous = input.afterSequence ?? 0;
    if (!Number.isInteger(previous) || previous < 0) {
      throw new Error("afterSequence must be a non-negative integer.");
    }
    for await (const event of this.store.streamEvents({
      jobId: record.id,
      ownerId: input.ownerId,
      afterSequence: previous,
      signal: input.signal,
    })) {
      if (event.sequence <= previous) {
        throw new Error("Job event stream is not strictly ordered.");
      }
      validateJobEvent(event);
      previous = event.sequence;
      yield event;
    }
  }

  async assertResultAdoptionFence(fence: JobExecutionFence): Promise<void> {
    const record = await this.inspect(fence.ownerId, fence.jobId);
    if (
      record.status !== "running" ||
      fence.attempt !== record.attempts ||
      new Date(fence.leaseExpiresAt).getTime() <= Date.now() ||
      !(await this.store.verifyLease(fence))
    ) {
      throw new Error("Lost or stale job lease cannot adopt sandbox results.");
    }
  }

  async cancel(input: {
    ownerId: string;
    jobId: string;
    reason: string;
  }): Promise<JobRuntimeRecord> {
    await this.inspect(input.ownerId, input.jobId);
    return this.store.requestCancellation({
      jobId: input.jobId,
      ownerId: input.ownerId,
      reason: nonEmpty(input.reason, "reason").slice(0, 1_000),
    });
  }
}

function validateJobEvent(event: JobRuntimeEventInput): void {
  if (!Number.isFinite(new Date(event.at).getTime()))
    throw new Error("Job event time is invalid.");
  if (event.type === "progress") {
    if (
      !Number.isFinite(event.current) ||
      !Number.isFinite(event.total) ||
      event.current < 0 ||
      event.total <= 0 ||
      event.current > event.total
    ) {
      throw new Error("Job progress must be bounded by a positive total.");
    }
    if (!event.unit.trim() || event.unit.length > 64) {
      throw new Error("Job progress requires a bounded unit.");
    }
  }
  if (event.type === "log" && event.message.length > 16_384) {
    throw new Error("Job log events are bounded to 16 KiB.");
  }
  if (
    event.type === "heartbeat" &&
    new Date(event.leaseExpiresAt).getTime() <= Date.now()
  ) {
    throw new Error("Heartbeat lease must expire in the future.");
  }
}

function isTerminal(status: JobRuntimeStatus): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

function nonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}
