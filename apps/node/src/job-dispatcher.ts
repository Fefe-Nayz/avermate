import type {
  NodeArtifactRef,
  NodeJobEvent,
  NodeJobV1,
  OwnedObjectRef,
} from "@avermate/agent-contracts";
import { nodeArtifactRefSchema, nodeJobV1Schema } from "@avermate/agent-contracts";
import { NodeJobLedger } from "./job-ledger";
import { GrantReplayLedger, verifyJobGrant } from "./protocol";

export type NodeJobHandlerContext = {
  job: NodeJobV1;
  /** Exact object authority proven by the signed Core grant. */
  grantedResources: readonly OwnedObjectRef[];
  signal: AbortSignal;
  progress(input: {
    numerator: number;
    denominator: number;
    unit: string;
    message: string;
  }): Promise<void>;
};

export interface NodeJobHandler {
  readonly kind: string;
  readonly capabilityVersion: number;
  readonly requiredCapability: string;
  execute(context: NodeJobHandlerContext): Promise<readonly NodeArtifactRef[]>;
  /**
   * Best-effort compensating cleanup when execution produced artifacts but the
   * durable job commit was fenced (for example by a concurrent cancellation).
   * Durable retention remains the backstop when this cleanup cannot reach the
   * object store.
   */
  cleanupResults?(
    job: NodeJobV1,
    results: readonly NodeArtifactRef[],
  ): Promise<void>;
}

function safeErrorCode(error: unknown) {
  const value = error instanceof Error ? error.message : "NODE_JOB_FAILED";
  return /^[A-Z0-9_:-]{3,128}$/u.test(value)
    ? value
    : "NODE_JOB_HANDLER_FAILED";
}

export class NodeJobHandlerRegistry {
  readonly #handlers = new Map<string, NodeJobHandler>();

  register(handler: NodeJobHandler) {
    if (!handler.kind || handler.kind.length > 128) {
      throw new Error("NODE_JOB_HANDLER_KIND_INVALID");
    }
    const key = this.#key(handler.kind, handler.capabilityVersion);
    if (this.#handlers.has(key)) throw new Error("NODE_JOB_HANDLER_DUPLICATE");
    this.#handlers.set(key, handler);
    return this;
  }

  resolve(kind: string, capabilityVersion: number) {
    return this.#handlers.get(this.#key(kind, capabilityVersion)) ?? null;
  }

  advertisedKinds() {
    return [...this.#handlers.values()]
      .map((handler) => `${handler.kind}@${handler.capabilityVersion}`)
      .sort();
  }

  #key(kind: string, version: number) {
    return `${kind}\0${version}`;
  }
}

/**
 * Verifies the Core grant, durably leases work, renews it, and publishes only
 * ledger-backed events. Unknown kinds/versions never enter the ledger.
 */
export class NodeJobDispatcher {
  readonly #nodeId: string;
  readonly #corePublicKeyDer: string;
  readonly #expectedPolicyRef: () => string;
  readonly #ledger: NodeJobLedger;
  readonly #grantReplay: GrantReplayLedger;
  readonly #registry: NodeJobHandlerRegistry;
  readonly #maximumConcurrent: number;
  readonly #leaseTtlMs: number;
  readonly #publish: (event: NodeJobEvent) => Promise<void>;
  readonly #active = new Map<string, AbortController>();

  constructor(input: {
    nodeId: string;
    corePublicKeyDer: string;
    expectedPolicyRef: () => string;
    ledger: NodeJobLedger;
    grantReplay: GrantReplayLedger;
    registry: NodeJobHandlerRegistry;
    maximumConcurrent: number;
    leaseTtlMs: number;
    publish?: (event: NodeJobEvent) => Promise<void>;
  }) {
    this.#nodeId = input.nodeId;
    this.#corePublicKeyDer = input.corePublicKeyDer;
    this.#expectedPolicyRef = input.expectedPolicyRef;
    this.#ledger = input.ledger;
    this.#grantReplay = input.grantReplay;
    this.#registry = input.registry;
    this.#maximumConcurrent = input.maximumConcurrent;
    this.#leaseTtlMs = input.leaseTtlMs;
    this.#publish = input.publish ?? (async () => undefined);
  }

  get activeCount() {
    return this.#active.size;
  }

  async recover(now = Date.now()) {
    const recovered = await this.#ledger.recoverExpired(now);
    for (const record of recovered) {
      await this.#publishDurably(record.events.at(-1)!);
    }
    return recovered.length;
  }

  async accept(raw: NodeJobV1, now = Date.now()) {
    const job = nodeJobV1Schema.parse(raw);
    if (job.principalRef.nodeId !== this.#nodeId) {
      throw new Error("JOB_WRONG_NODE");
    }
    const handler = this.#registry.resolve(job.kind, job.capabilityVersion);
    if (!handler) throw new Error("NODE_JOB_HANDLER_NOT_REGISTERED");
    if (job.policyRef !== this.#expectedPolicyRef()) {
      throw new Error("NODE_JOB_CONFIG_REVISION_MISMATCH");
    }
    if (Date.parse(job.limits.deadline) <= now) {
      throw new Error("NODE_JOB_DEADLINE_EXPIRED");
    }
    const claims = verifyJobGrant({
      job,
      issuerPublicKeyDer: this.#corePublicKeyDer,
      expectedAudience: this.#nodeId,
      requiredCapability: handler.requiredCapability,
      now,
    });
    await this.#grantReplay.accept(claims, job.envelopeDigest, now);
    const offered = await this.#ledger.offer(job, now);
    if (offered.replayed) {
      for (const event of offered.record.events) await this.#publishDurably(event);
      return { accepted: true, replayed: true };
    }
    await this.#publishDurably(offered.record.events[0]!);
    if (this.#active.size >= this.#maximumConcurrent) {
      await this.#failWithoutLease(job.id, "NODE_JOB_CAPACITY_EXCEEDED", now);
      return { accepted: false, replayed: false };
    }
    const controller = new AbortController();
    this.#active.set(job.id, controller);
    void this.#execute(job, handler, controller, claims.resources, now);
    return { accepted: true, replayed: false };
  }

  async cancel(jobId: string, now = Date.now()) {
    const record = await this.#ledger.requestCancellation(jobId, now);
    this.#active.get(jobId)?.abort("cancelled");
    await this.#publishDurably(record.events.at(-1)!);
    return record;
  }

  async acknowledge(jobId: string, sequence: number, now = Date.now()) {
    const record = await this.#ledger.get(jobId);
    if (!record || record.events.at(-1)?.sequence !== sequence) {
      throw new Error("NODE_JOB_ACK_SEQUENCE_MISMATCH");
    }
    return this.#ledger.acknowledgeCommit(jobId, now);
  }

  async replayPending() {
    const events = await this.#ledger.pendingRelayEvents();
    for (const event of events) await this.#publishDurably(event);
    return events.length;
  }

  async #execute(
    job: NodeJobV1,
    handler: NodeJobHandler,
    controller: AbortController,
    grantedResources: readonly OwnedObjectRef[],
    now: number,
  ) {
    const workerId = `worker_${crypto.randomUUID()}`;
    let leaseToken: string | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let producedResults: readonly NodeArtifactRef[] | null = null;
    try {
      const leased = await this.#ledger.lease({
        jobId: job.id,
        workerId,
        ttlMs: this.#leaseTtlMs,
        now,
      });
      leaseToken = leased.lease?.token ?? null;
      if (!leaseToken) throw new Error("JOB_LEASE_MISSING");
      await this.#publishDurably(leased.events.at(-1)!);
      heartbeat = setInterval(() => {
        if (!leaseToken) return;
        void this.#ledger
          .heartbeat({
            jobId: job.id,
            leaseToken,
            ttlMs: this.#leaseTtlMs,
          })
          .catch(() => controller.abort("lease-fenced"));
      }, Math.max(1_000, Math.floor(this.#leaseTtlMs / 3)));
      await this.#stage(job.id, leaseToken, "provisioning");
      await this.#stage(job.id, leaseToken, "running");
      producedResults = await handler.execute({
        job,
        grantedResources,
        signal: controller.signal,
        progress: async (progress) => {
          await this.#stage(job.id, leaseToken!, "running", progress);
        },
      });
      if (controller.signal.aborted) throw new Error("NODE_JOB_CANCELLED");
      const manifest = producedResults.map((artifact) =>
        nodeArtifactRefSchema.parse(artifact),
      );
      const outputBytes = manifest.reduce(
        (total, artifact) => total + artifact.byteSize,
        0,
      );
      if (outputBytes > job.limits.outputBytes) {
        throw new Error("NODE_JOB_OUTPUT_LIMIT_EXCEEDED");
      }
      await this.#stage(job.id, leaseToken, "adopting");
      await this.#stage(job.id, leaseToken, "completed", undefined, manifest);
    } catch (error) {
      if (!leaseToken) return;
      const current = await this.#ledger.get(job.id);
      if (
        producedResults &&
        current?.stage !== "completed" &&
        handler.cleanupResults
      ) {
        await handler.cleanupResults(job, producedResults).catch(() => undefined);
      }
      if (current?.stage === "cancel-requested" || controller.signal.aborted) {
        await this.#stage(job.id, leaseToken, "cancelled").catch(() => undefined);
      } else {
        await this.#stage(
          job.id,
          leaseToken,
          "failed",
          undefined,
          undefined,
          safeErrorCode(error),
        ).catch(() => undefined);
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.#active.delete(job.id);
    }
  }

  async #failWithoutLease(jobId: string, code: string, now: number) {
    const leased = await this.#ledger.lease({
      jobId,
      workerId: "capacity-fence",
      ttlMs: this.#leaseTtlMs,
      now,
    });
    const leaseToken = leased.lease?.token;
    if (!leaseToken) throw new Error("JOB_LEASE_MISSING");
    await this.#publishDurably(leased.events.at(-1)!);
    await this.#stage(jobId, leaseToken, "failed", undefined, undefined, code);
  }

  async #stage(
    jobId: string,
    leaseToken: string,
    stage: NodeJobEvent["stage"],
    progress?: NodeJobEvent["progress"],
    resultManifest?: readonly NodeArtifactRef[],
    safeError?: string,
  ) {
    const record = await this.#ledger.get(jobId);
    if (!record) throw new Error("JOB_NOT_FOUND");
    const terminal = ["cancelled", "completed", "failed"].includes(stage);
    const event: NodeJobEvent = {
      jobId,
      sequence: record.events.length + 1,
      eventId: `jobevt_${crypto.randomUUID()}`,
      stage,
      emittedAt: new Date().toISOString(),
      terminal,
      ...(progress ? { progress } : {}),
      ...(resultManifest ? { resultManifest: [...resultManifest] } : {}),
      ...(safeError ? { safeErrorCode: safeError } : {}),
    };
    const appended = await this.#ledger.appendEvent({ event, leaseToken });
    if (!appended.replayed) await this.#publishDurably(event);
    return appended.record;
  }

  async #publishDurably(event: NodeJobEvent) {
    // Transport failure never rolls back or hides the durable event. Reconnect
    // replay is driven from the ledger.
    await this.#publish(event).catch(() => undefined);
  }
}
