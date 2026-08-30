import {
  MAX_NODE_CONTROL_BUFFER_BYTES,
  MAX_NODE_CONTROL_FRAME_BYTES,
  MAX_NODE_STREAM_BUFFER_BYTES,
  nodeCapabilityEventV1Schema,
  nodeCapabilityJobManifestV1Schema,
  nodeCapabilityJobRequestDigestPayload,
  nodeCapabilityRequestDigestPayload,
  nodeCapabilityRequestV1Schema,
  nodeCapabilityResultV1Schema,
  nodeControlFrameSchema,
  nodeJobV1Schema,
  signedNodeCapabilityGrantSchema,
  signedNodeCapabilityInvocationGrantSchema,
  type NodeCapabilityEventV1,
  type NodeCapabilityHealth,
  type NodeCapabilityId,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityRequestV1,
  type NodeCapabilityResultV1,
  type NodeControlFrame,
  type NodeJobEvent,
  type NodeJobV1,
  type SignedNodeCapabilityGrant,
  type SignedNodeCapabilityInvocationGrant,
} from "@avermate/agent-contracts";
import { canonicalProtocolJson, protocolDigest } from "./protocol-crypto";
import {
  type AuthenticatedNodeCredential,
  CoreNodeRegistry,
  type NodeConnectionState,
} from "./node-registry";
import type { RelayOperationJournal } from "./node-relay-repository";

const textEncoder = new TextEncoder();
const TERMINAL_OPERATION_CACHE = 1_024;

function byteLength(value: string | Uint8Array) {
  return typeof value === "string"
    ? textEncoder.encode(value).byteLength
    : value.byteLength;
}

function encode(frame: NodeControlFrame) {
  const parsed = nodeControlFrameSchema.parse(frame);
  const body = JSON.stringify(parsed);
  if (byteLength(body) > MAX_NODE_CONTROL_FRAME_BYTES) {
    throw new Error("NODE_CONTROL_FRAME_TOO_LARGE");
  }
  return body;
}

function decode(value: string | Uint8Array) {
  if (byteLength(value) > MAX_NODE_CONTROL_FRAME_BYTES) {
    throw new Error("NODE_CONTROL_FRAME_TOO_LARGE");
  }
  const body =
    typeof value === "string" ? value : new TextDecoder().decode(value);
  return nodeControlFrameSchema.parse(JSON.parse(body));
}

function safeCode(error: unknown, fallback = "NODE_RELAY_PROTOCOL_ERROR") {
  const candidate = error instanceof Error ? error.message : fallback;
  return /^[A-Z0-9_:-]{3,128}$/u.test(candidate) ? candidate : fallback;
}

export type CoreRelaySocket = {
  send(payload: string): void | Promise<void>;
  close(code?: number, reason?: string): void | Promise<void>;
};

export class NodeRelayRemoteError extends Error {
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(code);
    this.name = "NodeRelayRemoteError";
    this.retryable = retryable;
  }
}

type ResultValue = {
  sequence: number;
  payload: unknown;
  hasPayload: boolean;
  terminal: boolean;
};

class ResultQueue implements AsyncIterable<ResultValue> {
  readonly #values: ResultValue[] = [];
  readonly #waiters: Array<{
    resolve: (value: IteratorResult<ResultValue>) => void;
    reject: (error: Error) => void;
  }> = [];
  #bufferedBytes = 0;
  #closed = false;
  #error: Error | null = null;

  push(value: ResultValue) {
    if (this.#closed) throw new Error("NODE_RELAY_RESULT_AFTER_TERMINAL");
    const encodedBytes = byteLength(JSON.stringify(value.payload ?? null));
    if (
      encodedBytes > MAX_NODE_CONTROL_FRAME_BYTES ||
      this.#values.length >= 1_024 ||
      this.#bufferedBytes + encodedBytes > MAX_NODE_STREAM_BUFFER_BYTES
    ) {
      throw new Error("NODE_RELAY_RESULT_BUFFER_OVERFLOW");
    }
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else {
      this.#values.push(value);
      this.#bufferedBytes += encodedBytes;
    }
    if (value.terminal) this.close();
  }

  close() {
    this.#closed = true;
    if (this.#values.length === 0) {
      for (const waiter of this.#waiters.splice(0)) {
        waiter.resolve({ done: true, value: undefined });
      }
    }
  }

  fail(error: Error) {
    if (this.#error || (this.#closed && this.#values.length === 0)) return;
    this.#error = error;
    this.#closed = true;
    if (this.#values.length === 0) {
      for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
    }
  }

  [Symbol.asyncIterator]() {
    return {
      next: (): Promise<IteratorResult<ResultValue>> => {
        const value = this.#values.shift();
        if (value) {
          this.#bufferedBytes -= byteLength(
            JSON.stringify(value.payload ?? null),
          );
          return Promise.resolve({ done: false, value });
        }
        if (this.#error) return Promise.reject(this.#error);
        if (this.#closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve, reject) => {
          this.#waiters.push({ resolve, reject });
        });
      },
    };
  }
}

type PendingOperation = {
  queue: ResultQueue;
  nextSequence: number;
  receivedBytes: number;
  byteLimit: number;
  deadlineTimer: ReturnType<typeof setTimeout>;
};

type PendingJob = {
  nextSequence: number;
  deadlineTimer: ReturnType<typeof setTimeout>;
  onEvent?: (event: NodeJobEvent) => Promise<void> | void;
  resolve: (event: NodeJobEvent) => void;
  reject: (error: Error) => void;
};

export class CoreRelayOperation implements AsyncIterable<unknown> {
  readonly operationId: string;
  readonly #queue: ResultQueue;
  readonly #journal: RelayOperationJournal;
  readonly #cancel: (reason: string) => Promise<void>;
  #iterated = false;

  constructor(input: {
    operationId: string;
    queue: ResultQueue;
    journal: RelayOperationJournal;
    cancel(reason: string): Promise<void>;
  }) {
    this.operationId = input.operationId;
    this.#queue = input.queue;
    this.#journal = input.journal;
    this.#cancel = input.cancel;
  }

  cancel(reason = "CALLER_CANCELLED") {
    return this.#cancel(reason);
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    if (this.#iterated)
      throw new Error("NODE_RELAY_OPERATION_ALREADY_CONSUMED");
    this.#iterated = true;
    const iterator = this.#queue[Symbol.asyncIterator]();
    return {
      next: async (): Promise<IteratorResult<unknown>> => {
        while (true) {
          const next = await iterator.next();
          if (next.done) return { done: true, value: undefined };
          await this.#journal.acknowledge(
            this.operationId,
            next.value.sequence,
          );
          if (next.value.hasPayload) {
            return { done: false, value: next.value.payload };
          }
          if (next.value.terminal) {
            return { done: true, value: undefined };
          }
        }
      },
      return: async () => {
        await this.cancel("CONSUMER_STOPPED").catch(() => undefined);
        return { done: true, value: undefined };
      },
    };
  }
}

export type DispatchNodeOperationInput = {
  userId: string;
  nodeId: string;
  capability: NodeCapabilityId;
  capabilityVersion: number;
  operationId: string;
  operation: string;
  payload: unknown;
  grant: SignedNodeCapabilityGrant;
  configRevision: string;
  deadline: string;
  signal?: AbortSignal;
};

type DispatchNodeCapabilityInput = {
  userId: string;
  nodeId: string;
  operation: "capability.invoke" | "capability.stream" | "capability.artifact-job";
  request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1;
  grant: SignedNodeCapabilityInvocationGrant;
  signal?: AbortSignal;
};

type RelayDispatchInput = Omit<DispatchNodeOperationInput, "grant"> & {
  grant: SignedNodeCapabilityGrant | SignedNodeCapabilityInvocationGrant;
};

function relayGrantByteLimit(
  grant: SignedNodeCapabilityGrant | SignedNodeCapabilityInvocationGrant,
) {
  const claims = grant.claims;
  if ("version" in claims) return claims.limits.byteLimit;
  const total = claims.limits.inputBytes + claims.limits.outputBytes;
  return Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER;
}

function exactCapabilityArtifacts(
  left: SignedNodeCapabilityInvocationGrant["claims"]["inputArtifacts"],
  right:
    | NodeCapabilityRequestV1["inputArtifacts"]
    | NodeCapabilityJobManifestV1["inputs"],
) {
  return canonicalProtocolJson(left) === canonicalProtocolJson(right);
}

export function coreNodeOperationRequestDigest(
  input: Omit<DispatchNodeOperationInput, "grant" | "signal">,
) {
  return protocolDigest({
    nodeId: input.nodeId,
    userId: input.userId,
    capability: input.capability,
    capabilityVersion: input.capabilityVersion,
    operationId: input.operationId,
    operation: input.operation,
    payload: input.payload,
    configRevision: input.configRevision,
    deadline: input.deadline,
  });
}

type RelayHooks = {
  onConnected?(input: {
    nodeId: string;
    userId: string;
    connectionEpoch: number;
  }): Promise<void>;
  onJobEvent?(input: {
    nodeId: string;
    userId: string;
    connectionEpoch: number;
    event: NodeJobEvent;
  }): Promise<void>;
  onHealth?(input: {
    nodeId: string;
    userId: string;
    connectionEpoch: number;
    health: NodeCapabilityHealth[];
  }): Promise<void>;
};

class RelaySession {
  readonly credential: AuthenticatedNodeCredential;
  readonly #relay: CoreNodeRelay;
  readonly #socket: CoreRelaySocket;
  readonly #pending = new Map<string, PendingOperation>();
  readonly #pendingJobs = new Map<string, PendingJob>();
  readonly #terminalOperationIds = new Set<string>();
  #state: NodeConnectionState | null = null;
  #health: NodeCapabilityHealth[] = [];
  #lastHeartbeatAt = 0;
  #closed = false;
  #incomingTail: Promise<void> = Promise.resolve();
  #queuedIncomingFrames = 0;
  #queuedIncomingBytes = 0;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(input: {
    relay: CoreNodeRelay;
    credential: AuthenticatedNodeCredential;
    socket: CoreRelaySocket;
  }) {
    this.#relay = input.relay;
    this.credential = input.credential;
    this.#socket = input.socket;
  }

  get state() {
    return this.#state;
  }

  get health() {
    return this.#health;
  }

  get lastHeartbeatAt() {
    return this.#lastHeartbeatAt;
  }

  get closed() {
    return this.#closed;
  }

  receive(raw: string | Uint8Array) {
    const bytes = byteLength(raw);
    if (
      this.#closed ||
      bytes > MAX_NODE_CONTROL_FRAME_BYTES ||
      this.#queuedIncomingFrames >= 64 ||
      this.#queuedIncomingBytes + bytes > MAX_NODE_CONTROL_BUFFER_BYTES
    ) {
      void this.close("NODE_CONTROL_BUFFER_OVERFLOW", 1009);
      return Promise.reject(new Error("NODE_CONTROL_BUFFER_OVERFLOW"));
    }
    this.#queuedIncomingFrames += 1;
    this.#queuedIncomingBytes += bytes;
    const handled = this.#incomingTail.then(() => this.#handle(decode(raw)));
    this.#incomingTail = handled
      .catch(async (error) => {
        await this.close(safeCode(error), 1008);
      })
      .finally(() => {
        this.#queuedIncomingFrames -= 1;
        this.#queuedIncomingBytes -= bytes;
      });
    return handled;
  }

  async #handle(frame: NodeControlFrame) {
    if (this.#closed) throw new Error("NODE_CAPABILITY_OFFLINE");
    if (!this.#state) {
      if (frame.type !== "hello") throw new Error("NODE_RELAY_HELLO_REQUIRED");
      if (frame.manifest.nodeId !== this.credential.nodeId) {
        throw new Error("NODE_RELAY_IDENTITY_MISMATCH");
      }
      const state = await this.#relay.registry.beginConnection({
        credential: this.credential,
        manifest: frame.manifest,
      });
      this.#state = state;
      this.#lastHeartbeatAt = this.#relay.now().getTime();
      await this.#relay.activate(this);
      await this.send({
        type: "relay-ready",
        frameId: `frame_${crypto.randomUUID()}`,
        nodeId: state.nodeId,
        protocolMajor: 2,
        connectionEpoch: state.connectionEpoch,
        credentialGeneration: state.credentialGeneration,
        acceptedConfigRevision: state.configRevision,
        heartbeatIntervalMs: this.#relay.heartbeatIntervalMs,
      });
      void this.#relay.hooks
        .onConnected?.({
          nodeId: state.nodeId,
          userId: state.userId,
          connectionEpoch: state.connectionEpoch,
        })
        .catch(() => undefined);
      this.#heartbeatTimer = setInterval(() => {
        if (
          this.#relay.now().getTime() - this.#lastHeartbeatAt >
          this.#relay.offlineGraceMs
        ) {
          void this.close("NODE_HEARTBEAT_TIMEOUT", 4001);
        }
      }, this.#relay.heartbeatIntervalMs);
      const timer = this.#heartbeatTimer as unknown as { unref?: () => void };
      timer.unref?.();
      return;
    }
    if (!this.#relay.isActive(this)) {
      throw new Error("NODE_CONNECTION_EPOCH_FENCED");
    }

    switch (frame.type) {
      case "heartbeat": {
        this.#assertEpoch(frame.nodeId, frame.connectionEpoch);
        const result = await this.#relay.registry.heartbeatConnection({
          nodeId: frame.nodeId,
          connectionEpoch: frame.connectionEpoch,
        });
        this.#lastHeartbeatAt = this.#relay.now().getTime();
        await this.send({
          type: "heartbeat-ack",
          frameId: `frame_${crypto.randomUUID()}`,
          nodeId: frame.nodeId,
          connectionEpoch: frame.connectionEpoch,
          sentAt: frame.sentAt,
          receivedAt: result.receivedAt,
        });
        return;
      }
      case "health":
        if (frame.nodeId !== this.#state.nodeId) {
          throw new Error("NODE_RELAY_IDENTITY_MISMATCH");
        }
        this.#health = frame.health;
        await this.#relay.hooks.onHealth?.({
          nodeId: this.#state.nodeId,
          userId: this.#state.userId,
          connectionEpoch: this.#state.connectionEpoch,
          health: frame.health,
        });
        return;
      case "job-event":
        this.#assertEpoch(frame.nodeId, frame.connectionEpoch);
        await this.#acceptJobEvent(frame.event);
        return;
      case "operation-result":
        this.#assertEpoch(frame.nodeId, frame.connectionEpoch);
        await this.#acceptOperationResult(frame);
        return;
      case "hello":
        throw new Error("NODE_RELAY_DUPLICATE_HELLO");
      case "relay-ready":
      case "heartbeat-ack":
      case "job-offer":
      case "job-cancel":
      case "job-ack":
      case "operation-request":
      case "operation-cancel":
      case "shutdown":
        throw new Error("NODE_CONTROL_DIRECTION_INVALID");
    }
  }

  async #acceptJobEvent(event: NodeJobEvent) {
    const state = this.#state;
    if (!state) throw new Error("NODE_RELAY_HELLO_REQUIRED");
    const pending = this.#pendingJobs.get(event.jobId);

    // A Node replays unacknowledged durable events immediately after reconnect.
    // Core may not have reclaimed the corresponding durable job yet, so an
    // unmatched replay is observable through the hook but is deliberately not
    // acknowledged or treated as a protocol violation.
    if (!pending) {
      await this.#relay.hooks.onJobEvent?.({
        nodeId: state.nodeId,
        userId: state.userId,
        connectionEpoch: state.connectionEpoch,
        event,
      });
      return;
    }
    if (event.sequence < pending.nextSequence) return;
    if (event.sequence !== pending.nextSequence) {
      throw new Error("NODE_JOB_EVENT_SEQUENCE_GAP");
    }
    pending.nextSequence += 1;
    await this.#relay.hooks.onJobEvent?.({
      nodeId: state.nodeId,
      userId: state.userId,
      connectionEpoch: state.connectionEpoch,
      event,
    });
    await pending.onEvent?.(event);
    if (!event.terminal) return;

    clearTimeout(pending.deadlineTimer);
    this.#pendingJobs.delete(event.jobId);
    if (event.stage === "completed") {
      // This is a commit acknowledgement, not a progress-event ack. The Node
      // retains all events until this exact terminal result has been consumed.
      await this.send({
        type: "job-ack",
        frameId: `frame_${crypto.randomUUID()}`,
        nodeId: state.nodeId,
        jobId: event.jobId,
        sequence: event.sequence,
      });
    }
    pending.resolve(event);
  }

  async offerJob(input: {
    job: NodeJobV1;
    signal?: AbortSignal;
    onEvent?: (event: NodeJobEvent) => Promise<void> | void;
  }) {
    const state = this.#state;
    if (!state || this.#closed) throw new Error("NODE_CAPABILITY_OFFLINE");
    const job = nodeJobV1Schema.parse(input.job);
    if (this.#pendingJobs.has(job.id)) {
      throw new Error("NODE_JOB_ALREADY_PENDING");
    }
    if (this.#pendingJobs.size >= this.#relay.maximumPendingJobs) {
      throw new Error("NODE_RELAY_JOB_CAPACITY_EXCEEDED");
    }
    const deadlineMs = Date.parse(job.limits.deadline);
    if (
      !Number.isFinite(deadlineMs) ||
      deadlineMs <= this.#relay.now().getTime()
    ) {
      throw new Error("NODE_JOB_DEADLINE_EXPIRED");
    }

    let resolve!: (event: NodeJobEvent) => void;
    let reject!: (error: Error) => void;
    const terminal = new Promise<NodeJobEvent>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    const deadlineTimer = setTimeout(
      () => {
        void this.cancelJob(job.id, "NODE_JOB_DEADLINE_EXCEEDED").finally(
          () => {
            reject(new Error("NODE_JOB_DEADLINE_EXCEEDED"));
          },
        );
      },
      Math.max(1, deadlineMs - this.#relay.now().getTime()),
    );
    const timer = deadlineTimer as unknown as { unref?: () => void };
    timer.unref?.();
    this.#pendingJobs.set(job.id, {
      nextSequence: 1,
      deadlineTimer,
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      resolve,
      reject,
    });
    try {
      await this.send({
        type: "job-offer",
        frameId: `frame_${crypto.randomUUID()}`,
        job,
      });
    } catch (error) {
      clearTimeout(deadlineTimer);
      this.#pendingJobs.delete(job.id);
      throw error;
    }
    if (input.signal) {
      if (input.signal.aborted) {
        await this.cancelJob(job.id, "CALLER_ABORTED");
      } else {
        input.signal.addEventListener(
          "abort",
          () => void this.cancelJob(job.id, "CALLER_ABORTED"),
          { once: true },
        );
      }
    }
    return terminal;
  }

  async cancelJob(jobId: string, reason: string) {
    const pending = this.#pendingJobs.get(jobId);
    const state = this.#state;
    if (!pending || !state) return;
    clearTimeout(pending.deadlineTimer);
    this.#pendingJobs.delete(jobId);
    await this.send({
      type: "job-cancel",
      frameId: `frame_${crypto.randomUUID()}`,
      nodeId: state.nodeId,
      jobId,
      reason: reason.slice(0, 512),
    }).catch(() => undefined);
    pending.reject(new Error(reason));
  }

  async #acceptOperationResult(
    frame: Extract<NodeControlFrame, { type: "operation-result" }>,
  ) {
    const pending = this.#pending.get(frame.operationId);
    if (!pending) {
      if (this.#terminalOperationIds.has(frame.operationId)) return;
      throw new Error("NODE_RELAY_OPERATION_UNKNOWN");
    }
    if (frame.sequence !== pending.nextSequence) {
      throw new Error("NODE_RELAY_SEQUENCE_GAP");
    }
    const resultBytes = byteLength(JSON.stringify(frame.payload ?? null));
    pending.receivedBytes += resultBytes;
    if (
      pending.receivedBytes > MAX_NODE_STREAM_BUFFER_BYTES ||
      pending.receivedBytes > pending.byteLimit
    ) {
      throw new Error("NODE_RELAY_RESULT_LIMIT_EXCEEDED");
    }
    await this.#relay.journal.advance({
      operationId: frame.operationId,
      expectedPreviousSequence: frame.sequence - 1,
      sequence: frame.sequence,
      ...(frame.terminal
        ? { terminalState: frame.ok ? "completed" : "failed" }
        : {}),
    });
    pending.nextSequence += 1;
    if (!frame.ok) {
      clearTimeout(pending.deadlineTimer);
      this.#pending.delete(frame.operationId);
      this.#rememberTerminal(frame.operationId);
      pending.queue.fail(
        new NodeRelayRemoteError(
          frame.safeErrorCode ?? "NODE_OPERATION_FAILED",
          frame.retryable,
        ),
      );
      return;
    }
    pending.queue.push({
      sequence: frame.sequence,
      payload: frame.payload,
      hasPayload: frame.payload !== undefined,
      terminal: frame.terminal,
    });
    if (frame.terminal) {
      clearTimeout(pending.deadlineTimer);
      this.#pending.delete(frame.operationId);
      this.#rememberTerminal(frame.operationId);
    }
  }

  async dispatch(input: RelayDispatchInput, requestDigest: string) {
    const state = this.#state;
    if (!state || this.#closed) throw new Error("NODE_CAPABILITY_OFFLINE");
    if (this.#pending.size >= this.#relay.maximumPendingOperations) {
      throw new Error("NODE_RELAY_CAPACITY_EXCEEDED");
    }
    if (this.#pending.has(input.operationId)) {
      throw new Error("NODE_RELAY_OPERATION_DUPLICATE");
    }
    const deadlineMs = Date.parse(input.deadline);
    if (
      !Number.isFinite(deadlineMs) ||
      deadlineMs <= this.#relay.now().getTime()
    ) {
      throw new Error("NODE_OPERATION_DEADLINE_EXPIRED");
    }
    const frame: NodeControlFrame = {
      type: "operation-request",
      frameId: `frame_${crypto.randomUUID()}`,
      nodeId: state.nodeId,
      connectionEpoch: state.connectionEpoch,
      operationId: input.operationId,
      capability: input.capability,
      capabilityVersion: input.capabilityVersion,
      operation: input.operation,
      configRevision: input.configRevision,
      deadline: input.deadline,
      grant: input.grant,
      payload: input.payload,
    };
    const body = encode(frame);
    await this.#relay.journal.begin({
      id: input.operationId,
      nodeId: input.nodeId,
      userId: input.userId,
      capability: input.capability,
      configRevision: input.configRevision,
      requestDigest,
      deadline: input.deadline,
    });
    const queue = new ResultQueue();
    const delay = Math.max(1, deadlineMs - this.#relay.now().getTime());
    const deadlineTimer = setTimeout(() => {
      void this.cancel(input.operationId, "DEADLINE_EXCEEDED");
    }, delay);
    const timer = deadlineTimer as unknown as { unref?: () => void };
    timer.unref?.();
    this.#pending.set(input.operationId, {
      queue,
      nextSequence: 1,
      receivedBytes: 0,
      byteLimit: relayGrantByteLimit(input.grant),
      deadlineTimer,
    });
    try {
      await this.#socket.send(body);
    } catch (error) {
      clearTimeout(deadlineTimer);
      this.#pending.delete(input.operationId);
      queue.fail(new Error("NODE_CAPABILITY_OFFLINE"));
      await this.#relay.journal.fail(input.operationId);
      throw error;
    }
    const operation = new CoreRelayOperation({
      operationId: input.operationId,
      queue,
      journal: this.#relay.journal,
      cancel: (reason) => this.cancel(input.operationId, reason),
    });
    if (input.signal) {
      if (input.signal.aborted) {
        await operation.cancel("CALLER_ABORTED");
      } else {
        input.signal.addEventListener(
          "abort",
          () => void operation.cancel("CALLER_ABORTED"),
          { once: true },
        );
      }
    }
    return operation;
  }

  async cancel(operationId: string, reason: string) {
    const pending = this.#pending.get(operationId);
    if (!pending) return;
    const state = this.#state;
    if (!state) return;
    clearTimeout(pending.deadlineTimer);
    this.#pending.delete(operationId);
    this.#rememberTerminal(operationId);
    await this.#relay.journal
      .requestCancellation(operationId)
      .catch(() => undefined);
    await this.send({
      type: "operation-cancel",
      frameId: `frame_${crypto.randomUUID()}`,
      nodeId: state.nodeId,
      connectionEpoch: state.connectionEpoch,
      operationId,
      reason: /^[A-Z0-9_:-]{3,128}$/u.test(reason)
        ? reason
        : "CALLER_CANCELLED",
    }).catch(() => undefined);
    await this.#relay.journal.fail(operationId);
    pending.queue.fail(new Error("NODE_OPERATION_CANCELLED"));
  }

  async send(frame: NodeControlFrame) {
    if (this.#closed) throw new Error("NODE_CAPABILITY_OFFLINE");
    await this.#socket.send(encode(frame));
  }

  async fence() {
    await this.close("REPLACED_BY_NEW_EPOCH", 4002);
  }

  async close(reason = "NODE_RELAY_DISCONNECTED", socketCode = 1000) {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    for (const [operationId, pending] of this.#pending) {
      clearTimeout(pending.deadlineTimer);
      pending.queue.fail(new Error("NODE_CAPABILITY_OFFLINE"));
      await this.#relay.journal.fail(operationId).catch(() => undefined);
    }
    this.#pending.clear();
    for (const pending of this.#pendingJobs.values()) {
      clearTimeout(pending.deadlineTimer);
      pending.reject(new Error("NODE_CAPABILITY_OFFLINE"));
    }
    this.#pendingJobs.clear();
    const state = this.#state;
    if (state) {
      await this.#relay.registry
        .disconnectConnection({
          nodeId: state.nodeId,
          connectionEpoch: state.connectionEpoch,
          safeCloseCode: safeCode(new Error(reason), "NODE_RELAY_DISCONNECTED"),
        })
        .catch(() => undefined);
    }
    this.#relay.deactivate(this);
    await Promise.resolve(
      this.#socket.close(socketCode, reason.slice(0, 123)),
    ).catch(() => undefined);
  }

  #rememberTerminal(operationId: string) {
    this.#terminalOperationIds.add(operationId);
    while (this.#terminalOperationIds.size > TERMINAL_OPERATION_CACHE) {
      const oldest = this.#terminalOperationIds.values().next().value;
      if (oldest === undefined) break;
      this.#terminalOperationIds.delete(oldest);
    }
  }

  #assertEpoch(nodeId: string, epoch: number) {
    if (
      !this.#state ||
      nodeId !== this.#state.nodeId ||
      epoch !== this.#state.connectionEpoch
    ) {
      throw new Error("NODE_CONNECTION_EPOCH_FENCED");
    }
  }
}

/** Production Core-side owner-fenced outbound relay. */
export class CoreNodeRelay {
  readonly registry: CoreNodeRegistry;
  readonly journal: RelayOperationJournal;
  readonly hooks: RelayHooks;
  readonly heartbeatIntervalMs: number;
  readonly offlineGraceMs: number;
  readonly maximumPendingOperations: number;
  readonly maximumPendingJobs: number;
  readonly now: () => Date;
  readonly #sessions = new Map<string, RelaySession>();
  readonly #allSessions = new Set<RelaySession>();

  constructor(input: {
    registry: CoreNodeRegistry;
    journal: RelayOperationJournal;
    hooks?: RelayHooks;
    heartbeatIntervalMs?: number;
    offlineGraceMs?: number;
    maximumPendingOperations?: number;
    maximumPendingJobs?: number;
    clock?: () => Date;
  }) {
    this.registry = input.registry;
    this.journal = input.journal;
    this.hooks = input.hooks ?? {};
    this.heartbeatIntervalMs = input.heartbeatIntervalMs ?? 15_000;
    this.offlineGraceMs = input.offlineGraceMs ?? 60_000;
    this.maximumPendingOperations = input.maximumPendingOperations ?? 128;
    this.maximumPendingJobs = input.maximumPendingJobs ?? 128;
    this.now = input.clock ?? (() => new Date());
    if (
      this.heartbeatIntervalMs < 1_000 ||
      this.heartbeatIntervalMs > 5 * 60_000 ||
      this.offlineGraceMs < this.heartbeatIntervalMs * 3 ||
      this.maximumPendingOperations < 1 ||
      this.maximumPendingOperations > 10_000 ||
      this.maximumPendingJobs < 1 ||
      this.maximumPendingJobs > 10_000
    ) {
      throw new Error("NODE_RELAY_LIMITS_INVALID");
    }
  }

  authenticate(authorization: string | null | undefined) {
    const match = /^Bearer ([A-Za-z0-9_-]{32,8192})$/u.exec(
      authorization ?? "",
    );
    if (!match?.[1]) throw new Error("NODE_RELAY_AUTHORIZATION_INVALID");
    return this.registry.authenticateCredential("relay", match[1]);
  }

  acceptAuthenticatedConnection(
    credential: AuthenticatedNodeCredential,
    socket: CoreRelaySocket,
  ) {
    if (credential.kind !== "relay") {
      throw new Error("NODE_RELAY_CREDENTIAL_REQUIRED");
    }
    const session = new RelaySession({ relay: this, credential, socket });
    this.#allSessions.add(session);
    return {
      receive: (raw: string | Uint8Array) => session.receive(raw),
      close: (reason?: string) => session.close(reason),
    };
  }

  async activate(session: RelaySession) {
    const state = session.state;
    if (!state) throw new Error("NODE_RELAY_HELLO_REQUIRED");
    const previous = this.#sessions.get(state.nodeId);
    this.#sessions.set(state.nodeId, session);
    if (previous && previous !== session) await previous.fence();
  }

  deactivate(session: RelaySession) {
    const state = session.state;
    if (state && this.#sessions.get(state.nodeId) === session) {
      this.#sessions.delete(state.nodeId);
    }
    this.#allSessions.delete(session);
  }

  isActive(session: RelaySession) {
    const state = session.state;
    return Boolean(state && this.#sessions.get(state.nodeId) === session);
  }

  async dispatchOperation(input: DispatchNodeOperationInput) {
    const session = this.#sessions.get(input.nodeId);
    const state = session?.state;
    if (!session || !state || session.closed) {
      throw new Error("NODE_CAPABILITY_OFFLINE");
    }
    if (state.userId !== input.userId) {
      throw new Error("NODE_CAPABILITY_OWNER_MISMATCH");
    }
    const grant = signedNodeCapabilityGrantSchema.parse(input.grant);
    const requestDigest = coreNodeOperationRequestDigest({
      userId: input.userId,
      nodeId: input.nodeId,
      capability: input.capability,
      capabilityVersion: input.capabilityVersion,
      operationId: input.operationId,
      operation: input.operation,
      payload: input.payload,
      configRevision: input.configRevision,
      deadline: input.deadline,
    });
    const now = this.now().getTime();
    const claims = grant.claims;
    const requestBytes = byteLength(JSON.stringify(input.payload ?? null));
    if (
      claims.audience !== input.nodeId ||
      claims.nodeId !== input.nodeId ||
      claims.userId !== input.userId ||
      claims.subject !== input.userId ||
      claims.jobId !== input.operationId ||
      claims.operation !== input.operation ||
      claims.requestDigest !== requestDigest ||
      claims.configRevision !== input.configRevision ||
      !claims.capabilities.includes(
        `node:${input.capability}:${input.operation}`,
      ) ||
      Date.parse(claims.notBefore) > now ||
      Date.parse(claims.expiresAt) <= now ||
      Date.parse(claims.limits.deadline) < Date.parse(input.deadline) ||
      requestBytes > claims.limits.byteLimit
    ) {
      throw new Error("NODE_OPERATION_GRANT_BINDING_INVALID");
    }
    await this.registry.assertCapabilityReady({
      nodeId: input.nodeId,
      userId: input.userId,
      capability: input.capability,
      configRevision: input.configRevision,
      connectionEpoch: state.connectionEpoch,
    });
    return session.dispatch({ ...input, grant }, requestDigest);
  }

  async requestOperation(input: DispatchNodeOperationInput) {
    const operation = await this.dispatchOperation(input);
    const values: unknown[] = [];
    for await (const value of operation) {
      values.push(value);
      if (values.length > 1) {
        await operation.cancel("UNEXPECTED_STREAM_RESULT");
        throw new Error("NODE_OPERATION_RESULT_CARDINALITY_INVALID");
      }
    }
    if (values.length !== 1) {
      throw new Error("NODE_OPERATION_RESULT_MISSING");
    }
    return values[0];
  }

  async dispatchCapability(input: DispatchNodeCapabilityInput) {
    const session = this.#sessions.get(input.nodeId);
    const state = session?.state;
    if (!session || !state || session.closed) {
      throw new Error("NODE_CAPABILITY_OFFLINE");
    }
    if (state.userId !== input.userId) {
      throw new Error("NODE_CAPABILITY_OWNER_MISMATCH");
    }
    const artifactJob = input.operation === "capability.artifact-job";
    const request = artifactJob
      ? nodeCapabilityJobManifestV1Schema.parse(input.request)
      : nodeCapabilityRequestV1Schema.parse(input.request);
    const inputArtifacts = artifactJob
      ? (request as NodeCapabilityJobManifestV1).inputs
      : (request as NodeCapabilityRequestV1).inputArtifacts;
    const grant = signedNodeCapabilityInvocationGrantSchema.parse(input.grant);
    const claims = grant.claims;
    const inference = state.manifest.features.inference;
    const advertised = inference?.offerings.find(
      (offering) => offering.descriptor.id === request.offeringId,
    );
    const now = this.now().getTime();
    const requestDigest = protocolDigest(
      artifactJob
        ? nodeCapabilityJobRequestDigestPayload(
            request as NodeCapabilityJobManifestV1,
          )
        : nodeCapabilityRequestDigestPayload(request as NodeCapabilityRequestV1),
    );
    const serializedInputBytes =
      byteLength(
        JSON.stringify(
          artifactJob
            ? (request as NodeCapabilityJobManifestV1).requestJson
            : request,
        ),
      ) +
      inputArtifacts.reduce(
        (total, artifact) => total + artifact.byteSize,
        0,
      );
    const mode =
      input.operation === "capability.invoke"
        ? "unary-relay"
        : input.operation === "capability.stream"
          ? "stream-relay"
          : "artifact-job";
    const manifestLimits = artifactJob
      ? (request as NodeCapabilityJobManifestV1).limits
      : null;
    if (
      !inference ||
      !advertised ||
      !inference.invocationModes.includes(mode) ||
      advertised.descriptorDigest !== request.offeringDigest ||
      advertised.descriptor.placement.kind !== "node" ||
      advertised.descriptor.placement.nodeId !== input.nodeId ||
      advertised.descriptor.placement.configRevision !== state.configRevision ||
      request.ownerId !== input.userId ||
      request.operationId !== claims.operationId ||
      request.configRevision !== state.configRevision ||
      request.requestDigest !== requestDigest ||
      claims.audience !== input.nodeId ||
      claims.nodeId !== input.nodeId ||
      claims.subject !== input.userId ||
      claims.ownerId !== input.userId ||
      claims.offeringId !== request.offeringId ||
      claims.offeringDigest !== request.offeringDigest ||
      claims.configRevision !== request.configRevision ||
      claims.requestDigest !== request.requestDigest ||
      claims.egressPolicyDigest !== advertised.network.egressPolicyDigest ||
      (artifactJob &&
        ((request as NodeCapabilityJobManifestV1).egressPolicyDigest !==
          claims.egressPolicyDigest ||
          canonicalProtocolJson(manifestLimits) !==
            canonicalProtocolJson(claims.limits))) ||
      !exactCapabilityArtifacts(claims.inputArtifacts, inputArtifacts) ||
      Date.parse(claims.notBefore) > now ||
      Date.parse(claims.expiresAt) <= now ||
      Date.parse(claims.limits.deadline) <= now ||
      serializedInputBytes > claims.limits.inputBytes
    ) {
      throw new Error("NODE_CAPABILITY_GRANT_BINDING_INVALID");
    }
    await this.registry.assertCapabilityReady({
      nodeId: input.nodeId,
      userId: input.userId,
      capability: "inference",
      configRevision: state.configRevision,
      connectionEpoch: state.connectionEpoch,
    });
    return session.dispatch(
      {
        userId: input.userId,
        nodeId: input.nodeId,
        capability: "inference",
        capabilityVersion: 1,
        operationId: request.operationId,
        operation: input.operation,
        payload: { ownerId: input.userId, input: request },
        grant,
        configRevision: request.configRevision,
        deadline: claims.limits.deadline,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      request.requestDigest,
    );
  }

  async requestCapability(input: Omit<DispatchNodeCapabilityInput, "operation">) {
    const operation = await this.dispatchCapability({
      ...input,
      operation: "capability.invoke",
    });
    const values: NodeCapabilityResultV1[] = [];
    for await (const value of operation) {
      values.push(nodeCapabilityResultV1Schema.parse(value));
      if (values.length > 1) {
        await operation.cancel("UNEXPECTED_STREAM_RESULT");
        throw new Error("NODE_CAPABILITY_RESULT_CARDINALITY_INVALID");
      }
    }
    if (values.length !== 1) {
      throw new Error("NODE_CAPABILITY_RESULT_MISSING");
    }
    return values[0]!;
  }

  async requestArtifactCapability(
    input: Omit<DispatchNodeCapabilityInput, "operation"> & {
      request: NodeCapabilityJobManifestV1;
    },
  ) {
    const operation = await this.dispatchCapability({
      ...input,
      operation: "capability.artifact-job",
    });
    const values: NodeCapabilityResultV1[] = [];
    for await (const value of operation) {
      values.push(nodeCapabilityResultV1Schema.parse(value));
      if (values.length > 1) {
        await operation.cancel("UNEXPECTED_STREAM_RESULT");
        throw new Error("NODE_CAPABILITY_RESULT_CARDINALITY_INVALID");
      }
    }
    if (values.length !== 1) {
      throw new Error("NODE_CAPABILITY_RESULT_MISSING");
    }
    return values[0]!;
  }

  async *streamCapability(
    input: Omit<DispatchNodeCapabilityInput, "operation">,
  ): AsyncIterable<NodeCapabilityEventV1> {
    const operation = await this.dispatchCapability({
      ...input,
      operation: "capability.stream",
    });
    for await (const value of operation) {
      yield nodeCapabilityEventV1Schema.parse(value);
    }
  }

  async dispatchJob(input: {
    userId: string;
    nodeId: string;
    job: NodeJobV1;
    signal?: AbortSignal;
    onEvent?: (event: NodeJobEvent) => Promise<void> | void;
  }) {
    const session = this.#sessions.get(input.nodeId);
    const state = session?.state;
    if (!session || !state || session.closed) {
      throw new Error("NODE_CAPABILITY_OFFLINE");
    }
    if (state.userId !== input.userId) {
      throw new Error("NODE_CAPABILITY_OWNER_MISMATCH");
    }
    const job = nodeJobV1Schema.parse(input.job);
    if (
      job.principalRef.nodeId !== input.nodeId ||
      job.principalRef.userId !== input.userId ||
      job.policyRef !== state.configRevision ||
      !state.manifest.features.jobs?.kinds.includes(
        `${job.kind}@${job.capabilityVersion}`,
      )
    ) {
      throw new Error("NODE_JOB_MANIFEST_BINDING_INVALID");
    }
    const claims = job.grant.claims;
    if (
      claims.nodeId !== input.nodeId ||
      claims.audience !== input.nodeId ||
      claims.userId !== input.userId ||
      claims.subject !== input.userId ||
      claims.jobId !== job.id ||
      claims.configRevision !== state.configRevision ||
      !claims.capabilities.includes(`jobs:${job.kind}`)
    ) {
      throw new Error("NODE_JOB_GRANT_BINDING_INVALID");
    }
    await this.registry.assertCapabilityReady({
      nodeId: input.nodeId,
      userId: input.userId,
      capability: "jobs",
      configRevision: state.configRevision,
      connectionEpoch: state.connectionEpoch,
    });
    return session.offerJob({
      job,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    });
  }

  async cancelJob(input: {
    userId: string;
    nodeId: string;
    jobId: string;
    reason?: string;
  }) {
    const session = this.#sessions.get(input.nodeId);
    if (!session?.state || session.state.userId !== input.userId) {
      throw new Error("NODE_CAPABILITY_OWNER_MISMATCH");
    }
    await session.cancelJob(input.jobId, input.reason ?? "CALLER_CANCELLED");
  }

  online(nodeId: string) {
    const session = this.#sessions.get(nodeId);
    return Boolean(
      session?.state &&
      !session.closed &&
      this.now().getTime() - session.lastHeartbeatAt <= this.offlineGraceMs,
    );
  }

  inspect(nodeId: string) {
    const session = this.#sessions.get(nodeId);
    const state = session?.state;
    if (!session || !state || !this.online(nodeId)) return null;
    return {
      nodeId,
      userId: state.userId,
      connectionEpoch: state.connectionEpoch,
      configRevision: state.configRevision,
      features: state.manifest.features,
      limits: state.manifest.limits,
      health: session.health,
      lastHeartbeatAt: new Date(session.lastHeartbeatAt).toISOString(),
    };
  }

  async shutdown() {
    await Promise.all(
      [...this.#allSessions].map((session) =>
        session.close("CORE_RELAY_SHUTDOWN", 1001),
      ),
    );
  }
}
