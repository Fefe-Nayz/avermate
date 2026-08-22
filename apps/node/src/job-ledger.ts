import {
  nodeJobEventSchema,
  nodeJobV1Schema,
  type NodeJobEvent,
  type NodeJobStage,
  type NodeJobV1,
} from "@avermate/agent-contracts";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalDigest } from "./canonical-json";

type JobLease = {
  token: string;
  workerId: string;
  expiresAt: string;
  heartbeatAt: string;
};

export type NodeJobRecord = {
  version: 1;
  job: NodeJobV1;
  principalFingerprint: string;
  idempotencyKey: string;
  envelopeDigest: string;
  stage: NodeJobStage;
  lease: JobLease | null;
  cancelRequested: boolean;
  commitAcknowledgedAt: string | null;
  events: NodeJobEvent[];
  createdAt: string;
  updatedAt: string;
};

type JobLedgerFile = { version: 1; jobs: Record<string, NodeJobRecord> };

const terminalStages = new Set<NodeJobStage>([
  "cancelled",
  "completed",
  "failed",
]);

const allowedTransitions: Record<NodeJobStage, readonly NodeJobStage[]> = {
  offered: ["leased", "cancel-requested", "failed"],
  leased: [
    "provisioning",
    "running",
    "cancel-requested",
    "failed",
    "inspect-required",
  ],
  provisioning: ["running", "cancel-requested", "failed", "inspect-required"],
  running: [
    "snapshotting",
    "adopting",
    "cancel-requested",
    "completed",
    "failed",
    "inspect-required",
  ],
  snapshotting: ["adopting", "cancel-requested", "failed", "inspect-required"],
  adopting: ["cancel-requested", "completed", "failed", "inspect-required"],
  "cancel-requested": ["cancelled", "failed", "inspect-required"],
  cancelled: [],
  completed: [],
  failed: [],
  "inspect-required": ["cancel-requested", "failed"],
};

async function atomicWrite(path: string, ledger: JobLedgerFile) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class NodeJobLedger {
  readonly #path: string;
  #state: JobLedgerFile | null = null;
  #mutex: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async #load() {
    if (this.#state) return this.#state;
    try {
      const parsed = JSON.parse(
        await readFile(this.#path, "utf8"),
      ) as JobLedgerFile;
      if (parsed.version !== 1)
        throw new Error("UNSUPPORTED_NODE_JOB_LEDGER_VERSION");
      this.#state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#state = { version: 1, jobs: {} };
    }
    return this.#state;
  }

  async #exclusive<T>(operation: (state: JobLedgerFile) => Promise<T> | T) {
    const previous = this.#mutex;
    let release!: () => void;
    this.#mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const state = await this.#load();
      const result = await operation(state);
      await atomicWrite(this.#path, state);
      return result;
    } finally {
      release();
    }
  }

  #principalFingerprint(job: NodeJobV1) {
    return canonicalDigest(job.principalRef);
  }

  async offer(input: NodeJobV1, now = Date.now()) {
    const job = nodeJobV1Schema.parse(input);
    return this.#exclusive((state) => {
      const principalFingerprint = this.#principalFingerprint(job);
      const collision = Object.values(state.jobs).find(
        (record) =>
          record.principalFingerprint === principalFingerprint &&
          record.idempotencyKey === job.idempotencyKey,
      );
      if (collision) {
        if (collision.envelopeDigest !== job.envelopeDigest) {
          throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
        }
        return { record: clone(collision), replayed: true };
      }
      if (state.jobs[job.id]) throw new Error("JOB_ID_COLLISION");
      const timestamp = new Date(now).toISOString();
      const firstEvent: NodeJobEvent = {
        jobId: job.id,
        sequence: 1,
        eventId: `jobevt_${crypto.randomUUID()}`,
        stage: "offered",
        emittedAt: timestamp,
        terminal: false,
      };
      const record: NodeJobRecord = {
        version: 1,
        job,
        principalFingerprint,
        idempotencyKey: job.idempotencyKey,
        envelopeDigest: job.envelopeDigest,
        stage: "offered",
        lease: null,
        cancelRequested: false,
        commitAcknowledgedAt: null,
        events: [firstEvent],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.jobs[job.id] = record;
      return { record: clone(record), replayed: false };
    });
  }

  async get(jobId: string) {
    const state = await this.#load();
    return state.jobs[jobId] ? clone(state.jobs[jobId]) : null;
  }

  async lease(input: {
    jobId: string;
    workerId: string;
    ttlMs: number;
    now?: number;
  }) {
    if (input.ttlMs < 1_000 || input.ttlMs > 5 * 60_000)
      throw new Error("JOB_LEASE_TTL_INVALID");
    const now = input.now ?? Date.now();
    return this.#exclusive((state) => {
      const record = state.jobs[input.jobId];
      if (!record) throw new Error("JOB_NOT_FOUND");
      if (terminalStages.has(record.stage)) return clone(record);
      if (record.lease && Date.parse(record.lease.expiresAt) > now) {
        if (record.lease.workerId !== input.workerId)
          throw new Error("JOB_ALREADY_LEASED");
        return clone(record);
      }
      const timestamp = new Date(now).toISOString();
      record.lease = {
        token: `lease_${crypto.randomUUID()}`,
        workerId: input.workerId,
        expiresAt: new Date(now + input.ttlMs).toISOString(),
        heartbeatAt: timestamp,
      };
      if (record.stage === "offered") {
        record.stage = "leased";
        record.events.push({
          jobId: record.job.id,
          sequence: record.events.length + 1,
          eventId: `jobevt_${crypto.randomUUID()}`,
          stage: "leased",
          emittedAt: timestamp,
          terminal: false,
        });
      }
      record.updatedAt = timestamp;
      return clone(record);
    });
  }

  async heartbeat(input: {
    jobId: string;
    leaseToken: string;
    ttlMs: number;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    return this.#exclusive((state) => {
      const record = state.jobs[input.jobId];
      if (!record?.lease || record.lease.token !== input.leaseToken) {
        throw new Error("JOB_LEASE_FENCED");
      }
      if (Date.parse(record.lease.expiresAt) <= now)
        throw new Error("JOB_LEASE_EXPIRED");
      record.lease.heartbeatAt = new Date(now).toISOString();
      record.lease.expiresAt = new Date(now + input.ttlMs).toISOString();
      record.updatedAt = record.lease.heartbeatAt;
      return clone(record);
    });
  }

  async appendEvent(input: {
    event: NodeJobEvent;
    leaseToken: string;
    now?: number;
  }) {
    const event = nodeJobEventSchema.parse(input.event);
    const now = input.now ?? Date.now();
    return this.#exclusive((state) => {
      const record = state.jobs[event.jobId];
      if (!record) throw new Error("JOB_NOT_FOUND");
      const duplicate = record.events.find(
        (item) => item.eventId === event.eventId,
      );
      if (duplicate) {
        if (canonicalDigest(duplicate) !== canonicalDigest(event)) {
          throw new Error("JOB_EVENT_REPLAY_MISMATCH");
        }
        return { record: clone(record), replayed: true };
      }
      if (!record.lease || record.lease.token !== input.leaseToken) {
        throw new Error("JOB_LEASE_FENCED");
      }
      if (Date.parse(record.lease.expiresAt) <= now)
        throw new Error("JOB_LEASE_EXPIRED");
      if (event.sequence !== record.events.length + 1)
        throw new Error("JOB_EVENT_OUT_OF_ORDER");
      if (!allowedTransitions[record.stage].includes(event.stage)) {
        throw new Error("JOB_STAGE_TRANSITION_INVALID");
      }
      if (event.terminal !== terminalStages.has(event.stage)) {
        throw new Error("JOB_TERMINAL_FLAG_MISMATCH");
      }
      if (event.stage === "completed" && !event.resultManifest) {
        throw new Error("JOB_RESULT_MANIFEST_REQUIRED");
      }
      record.events.push(event);
      record.stage = event.stage;
      record.updatedAt = event.emittedAt;
      if (event.terminal) record.lease = null;
      return { record: clone(record), replayed: false };
    });
  }

  async requestCancellation(jobId: string, now = Date.now()) {
    return this.#exclusive((state) => {
      const record = state.jobs[jobId];
      if (!record) throw new Error("JOB_NOT_FOUND");
      if (terminalStages.has(record.stage) || record.cancelRequested)
        return clone(record);
      record.cancelRequested = true;
      record.stage = "cancel-requested";
      const emittedAt = new Date(now).toISOString();
      record.events.push({
        jobId,
        sequence: record.events.length + 1,
        eventId: `jobevt_${crypto.randomUUID()}`,
        stage: "cancel-requested",
        emittedAt,
        terminal: false,
      });
      record.updatedAt = emittedAt;
      return clone(record);
    });
  }

  async acknowledgeCommit(jobId: string, now = Date.now()) {
    return this.#exclusive((state) => {
      const record = state.jobs[jobId];
      if (!record) throw new Error("JOB_NOT_FOUND");
      if (record.stage !== "completed") throw new Error("JOB_NOT_COMPLETED");
      record.commitAcknowledgedAt ??= new Date(now).toISOString();
      record.updatedAt = record.commitAcknowledgedAt;
      return clone(record);
    });
  }

  async events(jobId: string, afterSequence = 0, limit = 250) {
    if (limit < 1 || limit > 1_000) throw new Error("JOB_EVENT_LIMIT_INVALID");
    const record = await this.get(jobId);
    if (!record) throw new Error("JOB_NOT_FOUND");
    return record.events
      .filter((event) => event.sequence > afterSequence)
      .slice(0, limit);
  }
}
