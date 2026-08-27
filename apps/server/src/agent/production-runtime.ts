import {
  agentCancelInputSchema,
  agentForkInputSchema,
  agentInspectInputSchema,
  agentResumeInputSchema,
  agentRunInputSchema,
  type AgentCancelInput,
  type AgentForkInput,
  type AgentInspectInput,
  type AgentRunHandle,
  type AgentRunInput,
  type AgentRuntime,
  type AgentRuntimeState,
  type ConversationCheckpointRef,
  type ModelPlacement,
  type ModelReadiness,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { newId } from "../lib/id";
import { canonicalJson, sha256 } from "../search/values";
import type { ToolBroker } from "../tools/broker";
import type { ToolRegistry } from "../tools/registry";
import type { CoreConversationCheckpointStore } from "../assistant/checkpoint-store";
import {
  AssistantGraphExecutor,
  type AssistantApprovalResumeValue,
  type AssistantGatewayResolver,
  type AssistantGatewaySelection,
  type AssistantRegistryFactory,
  type AssistantRunExecutionControl,
  type AssistantContextRetriever,
  type AssistantContextAssetHandleMinter,
  type ExplicitSourceIndexer,
} from "../assistant/run-service";
import {
  CoreConversationStore,
  type AssistantSqlClient,
} from "../assistant/core-conversation-store";
import {
  ProductionRunControlStore,
  RunControlError,
  type RunLeaseFence,
} from "./run-control-store";

export const PRODUCTION_AGENT_RUNTIME_ID = "avermate-agent-runtime" as const;
export const PRODUCTION_AGENT_RUNTIME_VERSION = "1" as const;
export const PRODUCTION_AGENT_GRAPH_SCHEMA_VERSION = 1 as const;
export const PRODUCTION_AGENT_POLICY_REVISION = "assistant-policy/1" as const;

const approvalResumeValueSchema = z.strictObject({
  actionId: z.string().min(1).max(256),
  toolCallId: z.string().min(1).max(256).nullable(),
  status: z.enum([
    "completed",
    "rejected",
    "expired",
    "failed",
    "inspect-required",
  ]),
  modelResult: z.unknown(),
});

const questionResumeValueSchema = z.strictObject({
  questionId: z.string().min(1).max(256),
  answer: z.string().trim().min(1).max(20_000),
});

export type ProductionAgentRuntimeDependencies = {
  client: AssistantSqlClient;
  conversations: CoreConversationStore;
  gateways: AssistantGatewayResolver;
  registryFactory: AssistantRegistryFactory;
  sourceIndexer?: ExplicitSourceIndexer;
  checkpoints: CoreConversationCheckpointStore;
  lexical?: Pick<
    import("@avermate/agent-contracts").LexicalSearchBackend,
    "search"
  >;
  retrieval?: AssistantContextRetriever;
  contextAssetHandles?: AssistantContextAssetHandleMinter;
  recoveryBrokerFactory?: (ownerId: string) => Promise<ToolBroker>;
  workerId?: string;
  leaseTtlMs?: number;
};

function exactPlacement(selection: AssistantGatewaySelection): ModelPlacement {
  if (selection.modelPlacement) return selection.modelPlacement;
  switch (selection.capability.placement) {
    case "core":
      return {
        kind: "core",
        instanceId: process.env.CORE_INSTANCE_ID?.trim() || "core-default",
      };
    case "managed":
      return {
        kind: "managed",
        pool: "managed-default",
        region: process.env.MANAGED_REGION?.trim() || "unknown",
      };
    case "direct-byok":
      throw new Error(
        "Direct/BYOK adapters must declare their public HTTPS placement origin",
      );
    case "node":
      throw new Error(
        "Node adapters must declare the paired node and capability revision",
      );
  }
}

function catalogueRevision(
  registry: ToolRegistry,
  approvalMode: "read-only" | "confirm-writes" | "auto-reversible",
): string {
  return `sha256:${sha256(
    canonicalJson(
      registry
        .list()
        .filter(
          (descriptor) =>
            approvalMode !== "read-only" || descriptor.effect === "read",
        )
        .map((descriptor) => ({
          id: descriptor.id,
          version: descriptor.version,
          effect: descriptor.effect,
          risk: descriptor.risk,
          approval: descriptor.approval,
          compensation: descriptor.compensation,
          idempotency: descriptor.idempotency,
          crashRecovery: descriptor.crashRecovery ?? "inspect-required",
          requiredScopes: [...descriptor.requiredScopes].sort(),
          inputSchema: z.toJSONSchema(descriptor.inputSchema),
        })),
    ),
  )}`;
}

function terminal(status: string): boolean {
  return ["complete", "failed", "cancelled"].includes(status);
}

/**
 * The only production entrypoint for assistant execution. The explicit
 * Avermate graph executor owns orchestration while durable authority stays in
 * the conversation/checkpoint/action stores and the run-control fences below.
 * The LangGraph adapter remains a conformance spike; production deliberately
 * avoids introducing a second framework-owned checkpoint history.
 */
export class ProductionAgentRuntime implements AgentRuntime {
  readonly #executor: AssistantGraphExecutor;
  readonly #controls: ProductionRunControlStore;
  readonly #active = new Map<string, Promise<AgentRuntimeState>>();
  readonly #workerId: string;
  readonly #leaseTtlMs: number;

  constructor(
    private readonly dependencies: ProductionAgentRuntimeDependencies,
  ) {
    this.#executor = new AssistantGraphExecutor(
      dependencies.client,
      dependencies.conversations,
      dependencies.gateways,
      dependencies.registryFactory,
      dependencies.sourceIndexer,
      dependencies.checkpoints,
      dependencies.lexical,
      dependencies.retrieval,
      dependencies.contextAssetHandles,
    );
    this.#controls = new ProductionRunControlStore(dependencies.client);
    this.#workerId =
      dependencies.workerId ?? `agent-runtime:${crypto.randomUUID()}`;
    // A model/tool round can legitimately hold the JavaScript event loop long
    // enough that a five-second heartbeat is not schedulable (notably while
    // SQLite serializes a checkpoint). Keep the production lease above that
    // jitter window; the store itself still supports short leases in its
    // deterministic fencing tests.
    this.#leaseTtlMs = Math.max(
      30_000,
      Math.min(300_000, dependencies.leaseTtlMs ?? 30_000),
    );
  }

  listModels(ownerId: string) {
    return this.dependencies.gateways.list(ownerId);
  }

  async resolveModel(ownerId: string, modelKey: string) {
    return this.dependencies.gateways.resolve(ownerId, modelKey);
  }

  resolveModelForNewRun(ownerId: string, requestedModelKey?: string) {
    if (!this.dependencies.gateways.resolveForNewRun) {
      throw new Error("The gateway resolver cannot freeze a run model policy");
    }
    return this.dependencies.gateways.resolveForNewRun(
      ownerId,
      requestedModelKey,
    );
  }

  async modelCatalogue(ownerId: string): Promise<ModelReadiness[]> {
    if (this.dependencies.gateways.readiness) {
      return this.dependencies.gateways.readiness(ownerId);
    }
    const capabilities = await this.dependencies.gateways.list(ownerId);
    return Promise.all(
      capabilities.map(async (capability) => {
        const selection = await this.dependencies.gateways.resolve(
          ownerId,
          capability.modelKey,
        );
        return {
          capability,
          available: true,
          unavailableReason: null,
          modelRevision:
            selection.modelRevision ?? `${selection.descriptor.id}/adapter-1`,
          providerRevision:
            selection.providerRevision ?? `${capability.providerKey}/adapter-1`,
          placement: exactPlacement(selection),
          routeKey: `${capability.providerKey}:${capability.modelKey}`,
          fallbackEligible: false,
        };
      }),
    );
  }

  /** Fire-and-observe adapter used by authenticated oRPC handlers. */
  launch(ownerId: string, runId: string, broker?: ToolBroker): void {
    void this.#begin(ownerId, runId, broker).catch(() => {
      // Details can contain provider text or URLs; the durable safe error and
      // terminal event are the observability surface.
      console.error("[assistant-runtime] run failed", { runId });
    });
  }

  async runNow(ownerId: string, runId: string, broker?: ToolBroker) {
    return this.#begin(ownerId, runId, broker);
  }

  #begin(
    ownerId: string,
    runId: string,
    broker?: ToolBroker,
    approvalResume?: AssistantApprovalResumeValue,
  ): Promise<AgentRuntimeState> {
    const active = this.#active.get(runId);
    if (active) return active;
    const completion = this.#execute(
      ownerId,
      runId,
      broker,
      approvalResume,
    ).finally(() => this.#active.delete(runId));
    this.#active.set(runId, completion);
    return completion;
  }

  async #execute(
    ownerId: string,
    runId: string,
    broker?: ToolBroker,
    approvalResume?: AssistantApprovalResumeValue,
  ): Promise<AgentRuntimeState> {
    const run = await this.dependencies.conversations.run(ownerId, runId);
    if (terminal(run.status)) return this.inspect({ ownerId, runId });
    if (
      run.approvalMode !== "read-only" &&
      process.env.ASSISTANT_FORCE_READ_ONLY === "true"
    ) {
      throw new Error("Mutation-enabled assistant runs are disabled");
    }
    const selection = await this.dependencies.gateways.resolve(
      ownerId,
      run.modelKey,
      runId,
    );
    const registry =
      broker?.registry ?? (await this.dependencies.registryFactory(ownerId));
    const placement = exactPlacement(selection);
    const modelRevision =
      selection.modelRevision ?? `${selection.descriptor.id}/adapter-1`;
    const providerRevision =
      selection.providerRevision ??
      `${selection.capability.providerKey}/adapter-1`;
    await this.#controls.freezeRunConfiguration({
      ownerId,
      runId,
      runtimeId: PRODUCTION_AGENT_RUNTIME_ID,
      runtimeVersion: PRODUCTION_AGENT_RUNTIME_VERSION,
      modelKey: selection.capability.modelKey,
      modelRevision,
      providerKey: selection.capability.providerKey,
      providerRevision,
      modelPlacement: placement,
      policyRevision: PRODUCTION_AGENT_POLICY_REVISION,
      toolCatalogRevision: catalogueRevision(registry, run.approvalMode),
      branchIdentityDigest: sha256(
        canonicalJson({
          threadId: run.threadId,
          branchId: run.branchId,
          inputMessageId: run.inputMessageId,
          reservedOutputMessageId: run.reservedOutputMessageId,
          parentRunId: run.parentRunId,
        }),
      ),
      approvalMode: run.approvalMode,
    });
    let lease = await this.#controls.acquireLease({
      ownerId,
      runId,
      workerId: this.#workerId,
      ttlMs: this.#leaseTtlMs,
    });
    let released = false;
    const fence = (): RunLeaseFence => ({
      id: lease.id,
      ownerId,
      runId,
      workerId: this.#workerId,
      fencingToken: lease.fencingToken,
    });
    // Keep renewal and release ordered. A renewal can still be in flight when
    // the executor returns; releasing concurrently with that write used to
    // leave a successfully completed run with an active lease on SQLite.
    let pendingHeartbeat = Promise.resolve();
    const heartbeat = setInterval(
      () => {
        pendingHeartbeat = pendingHeartbeat.then(async () => {
          try {
            lease = await this.#controls.renewLease(fence(), this.#leaseTtlMs);
          } catch {
            // The fenced operation below remains authoritative. A failed
            // heartbeat must not create an unhandled rejection, and release will
            // surface a stale fence instead of silently retaining the lease.
          }
        });
      },
      Math.max(2_000, Math.floor(this.#leaseTtlMs / 3)),
    );
    (heartbeat as unknown as { unref?: () => void }).unref?.();
    const control: AssistantRunExecutionControl = {
      approvalMode: run.approvalMode,
      freezeContextManifest: (digest) =>
        this.#controls.freezeContextManifest({
          ownerId,
          runId,
          digest,
          fence: fence(),
        }),
      claimDispatch: ({
        round,
        attempt = 0,
        requestDigest,
        stableRequestKey,
        selection: attemptedSelection,
      }) => {
        const attemptedPlacement = exactPlacement(attemptedSelection);
        const attemptedModelRevision =
          attemptedSelection.modelRevision ??
          `${attemptedSelection.descriptor.id}/adapter-1`;
        const attemptedProviderRevision =
          attemptedSelection.providerRevision ??
          `${attemptedSelection.capability.providerKey}/adapter-1`;
        return this.#controls
          .claimProviderDispatch(
            {
              ownerId,
              runId,
              dispatchKey: `model-round:${round}:attempt:${attempt}`,
              requestDigest,
              providerKey: attemptedSelection.capability.providerKey,
              providerRevision: attemptedProviderRevision,
              modelKey: attemptedSelection.capability.modelKey,
              modelRevision: attemptedModelRevision,
              placement: attemptedPlacement,
              providerSupportsStableRequestKey:
                attemptedSelection.providerSupportsStableRequestKey === true,
              stableRequestKey,
            },
            fence(),
          )
          .then(() => undefined);
      },
      transitionDispatch: ({ round, attempt = 0, state, inspectReason }) =>
        this.#controls
          .transitionProviderDispatch({
            ownerId,
            runId,
            dispatchKey: `model-round:${round}:attempt:${attempt}`,
            state,
            inspectReason,
            fence: fence(),
          })
          .then(() => undefined),
      cancellationRequested: () =>
        this.#controls.cancellationRequested(ownerId, runId, fence()),
      suspendForApproval: async () => {
        await this.#controls.markWaitingApproval({
          ownerId,
          runId,
          fence: fence(),
        });
        await this.#controls.releaseLease(fence());
        released = true;
      },
    };
    try {
      if (approvalResume) {
        if (!broker) throw new Error("Approval resume requires a tool broker");
        await this.#executor.resumeApprovalNow(
          ownerId,
          runId,
          approvalResume,
          broker,
          control,
        );
      } else {
        await this.#executor.runNow(ownerId, runId, broker, control);
      }
    } finally {
      clearInterval(heartbeat);
      await pendingHeartbeat;
      if (!released) {
        await this.#controls.releaseLease(fence());
      }
    }
    return this.inspect({ ownerId, runId });
  }

  async start(inputValue: AgentRunInput): Promise<AgentRunHandle> {
    const input = agentRunInputSchema.parse(inputValue);
    if (
      input.graphSchemaVersion !== String(PRODUCTION_AGENT_GRAPH_SCHEMA_VERSION)
    ) {
      throw new Error("Unsupported production graph schema version");
    }
    const run = await this.dependencies.conversations.run(
      input.ownerId,
      input.runId,
    );
    if (run.threadId !== input.threadId || run.branchId !== input.branchId) {
      throw new Error("Run is bound to another conversation boundary");
    }
    const completed = this.#begin(input.ownerId, input.runId);
    return {
      runId: input.runId,
      conversationCheckpointRef: run.conversationCheckpointRef,
      completed,
    };
  }

  async resume(inputValue: Parameters<AgentRuntime["resume"]>[0]) {
    const input = agentResumeInputSchema.parse(inputValue);
    const run = await this.dependencies.conversations.run(
      input.ownerId,
      input.runId,
    );
    if (run.conversationCheckpointRef !== input.conversationCheckpointRef) {
      throw new Error("Resume checkpoint is not current");
    }
    const approval = approvalResumeValueSchema.safeParse(input.resumeValue);
    const broker = this.dependencies.recoveryBrokerFactory
      ? await this.dependencies.recoveryBrokerFactory(input.ownerId)
      : undefined;
    if (approval.success) {
      if (!broker) throw new Error("Approval resume broker is unavailable");
      await this.#controls.resumeWaitingRun(input.ownerId, input.runId);
      return {
        runId: input.runId,
        conversationCheckpointRef: input.conversationCheckpointRef,
        completed: this.#begin(
          input.ownerId,
          input.runId,
          broker,
          approval.data,
        ),
      };
    }
    const question = questionResumeValueSchema.parse(input.resumeValue);
    await this.dependencies.conversations.respondToQuestion({
      ownerId: input.ownerId,
      runId: input.runId,
      ...question,
    });
    return {
      runId: input.runId,
      conversationCheckpointRef: input.conversationCheckpointRef,
      completed: this.#begin(input.ownerId, input.runId, broker),
    };
  }

  async resumeApproval(
    ownerId: string,
    runId: string,
    value: AssistantApprovalResumeValue,
    broker: ToolBroker,
  ): Promise<void> {
    approvalResumeValueSchema.parse(value);
    await this.#controls.resumeWaitingRun(ownerId, runId);
    await this.#begin(ownerId, runId, broker, value);
  }

  async respondToQuestion(input: {
    ownerId: string;
    runId: string;
    questionId: string;
    answer: string;
    broker?: ToolBroker;
  }) {
    await this.dependencies.conversations.respondToQuestion(input);
    return this.#begin(input.ownerId, input.runId, input.broker);
  }

  async cancel(inputValue: AgentCancelInput): Promise<void> {
    const input = agentCancelInputSchema.parse(inputValue);
    const changed = await this.#controls.requestCancellation(input);
    if (!changed) return;
    await this.#executor.cancel(input.ownerId, input.runId);
  }

  cancelRun(ownerId: string, runId: string, reason = "User cancelled") {
    return this.cancel({ ownerId, runId, reason }).then(() =>
      this.dependencies.conversations.run(ownerId, runId),
    );
  }

  async fork(inputValue: AgentForkInput): Promise<ConversationCheckpointRef> {
    const input = agentForkInputSchema.parse(inputValue);
    if (!input.boundary.conversationCheckpointRef) {
      throw new Error("Forking requires a committed conversation checkpoint");
    }
    // ConversationStore reserves the target DAG branch/run before this method
    // can execute. The legacy interface lacks targetRunId, so returning a fake
    // runtime checkpoint would violate ownership and replay invariants.
    throw new Error(
      "Reserve the target conversation branch, then launch it through the production runtime",
    );
  }

  async inspect(inputValue: AgentInspectInput): Promise<AgentRuntimeState> {
    const input = agentInspectInputSchema.parse(inputValue);
    const run = await this.dependencies.conversations.run(
      input.ownerId,
      input.runId,
    );
    const phase: AgentRuntimeState["phase"] =
      run.status === "reserved"
        ? "queued"
        : run.status === "complete"
          ? "finished"
          : run.status === "failed"
            ? "failed"
            : run.status === "cancelled"
              ? "cancelled"
              : run.status === "waiting-approval" ||
                  run.status === "waiting-for-user"
                ? "interrupted"
                : "running";
    const boundary = {
      ...(run.conversationCheckpointRef
        ? { conversationCheckpointRef: run.conversationCheckpointRef }
        : {}),
      ...(run.workspaceSnapshotRef
        ? { workspaceSnapshotRef: run.workspaceSnapshotRef }
        : {}),
      ...(run.sandboxRuntimeCheckpointRef
        ? { sandboxRuntimeCheckpointRef: run.sandboxRuntimeCheckpointRef }
        : {}),
      ...(run.domainCursorRef ? { domainCursorRef: run.domainCursorRef } : {}),
    };
    return {
      runId: run.id,
      phase,
      graphSchemaVersion: String(run.graphSchemaVersion),
      ...(Object.keys(boundary).length > 0 ? { boundary } : {}),
      interrupt:
        phase === "interrupted"
          ? {
              kind: run.status === "waiting-approval" ? "approval" : "question",
            }
          : null,
    };
  }

  async recoverInterrupted(
    brokerFactory = this.dependencies.recoveryBrokerFactory,
    limit = 100,
  ): Promise<{
    resumed: string[];
    finalizedFromCheckpoint: string[];
    failedClosed: string[];
    waitingApproval: string[];
  }> {
    const reconciliation = await this.#controls.reconcileOrphans(limit);
    const resumed: string[] = [];
    const failedClosed: string[] = [];
    for (const runId of reconciliation.inspectRequired) {
      const row = await this.dependencies.client.execute({
        sql: `SELECT userId FROM assistant_runs WHERE id = ? LIMIT 1`,
        args: [runId],
      });
      const ownerId = row.rows[0]?.userId;
      if (!ownerId) continue;
      const run = await this.dependencies.conversations.run(
        String(ownerId),
        runId,
      );
      await this.dependencies.conversations.finalizeRun({
        ownerId: String(ownerId),
        runId,
        expectedInputHeadId: run.inputMessageId,
        outputMessageId: run.reservedOutputMessageId,
        finalParts: [
          {
            type: "safe-error",
            id: newId("apart"),
            code: "provider_dispatch_unknown",
            message:
              "The provider may have received the request before it stopped. Check before trying again.",
            retryable: false,
          },
        ],
        citations: [],
        usage: {
          providerKey: run.providerKey,
          providerRevision: run.providerRevision,
          modelKey: run.modelKey,
          modelRevision: run.modelRevision,
          source: "unknown",
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          cachedReadTokens: null,
          cachedWriteTokens: null,
          estimatedCost: null,
          currency: null,
        },
        terminal: "failed",
        terminalReason: "provider-dispatch-unknown",
        safeError: {
          code: "provider_dispatch_unknown",
          message: "Provider outcome requires inspection",
        },
        siblingPolicy: "create-explicit-sibling-on-head-conflict",
      });
      failedClosed.push(runId);
    }
    for (const runId of reconciliation.cancelling) {
      const row = await this.dependencies.client.execute({
        sql: `SELECT userId FROM assistant_runs WHERE id = ? LIMIT 1`,
        args: [runId],
      });
      if (row.rows[0]?.userId) {
        await this.dependencies.conversations.cancelRun(
          String(row.rows[0].userId),
          runId,
        );
      }
    }
    if (brokerFactory) {
      for (const runId of [
        ...new Set([
          ...reconciliation.queued,
          ...reconciliation.replayableDispatches,
        ]),
      ]) {
        const row = await this.dependencies.client.execute({
          sql: `SELECT userId FROM assistant_runs WHERE id = ? LIMIT 1`,
          args: [runId],
        });
        if (!row.rows[0]?.userId) continue;
        const ownerId = String(row.rows[0].userId);
        this.launch(ownerId, runId, await brokerFactory(ownerId));
        resumed.push(runId);
      }
    }
    return {
      resumed,
      finalizedFromCheckpoint: [],
      failedClosed,
      waitingApproval: reconciliation.waitingApproval,
    };
  }
}

export function createProductionAgentRuntime(
  dependencies: ProductionAgentRuntimeDependencies,
): ProductionAgentRuntime {
  return new ProductionAgentRuntime(dependencies);
}
