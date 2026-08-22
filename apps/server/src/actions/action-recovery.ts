import type {
  ToolCapabilityResolver,
  ToolEventSink,
} from "@avermate/agent-contracts";
import {
  ActionLedgerService,
  DurableToolActionLedgerWriter,
} from "./action-ledger";
import { continuationMatches } from "./approval-execution";
import type { ToolBroker } from "../tools/broker";
import {
  noOpToolCapabilities,
  noOpToolEvents,
} from "../tools/broker";
import type { ToolActionContinuationStore } from "../tools/action-continuation";

export type InterruptedActionRecoveryResult = {
  resumed: string[];
  inspectRequired: string[];
  failed: string[];
  deferred: string[];
};

/**
 * Reconcile durable action claims left behind by a stopped process.
 *
 * Only descriptors which explicitly promise idempotent retry are executed.
 * Everything ambiguous is terminally surfaced for human inspection; transient
 * broker construction failures remain `executing` so another startup can try
 * again instead of silently losing the operation.
 */
export async function recoverInterruptedActions(input: {
  ledger: ActionLedgerService;
  continuations: ToolActionContinuationStore;
  brokerForOwner: (userId: string) => Promise<ToolBroker>;
  capabilities?: ToolCapabilityResolver;
  events?: ToolEventSink;
  limit?: number;
}): Promise<InterruptedActionRecoveryResult> {
  const result: InterruptedActionRecoveryResult = {
    resumed: [],
    inspectRequired: [],
    failed: [],
    deferred: [],
  };
  const interrupted = await input.ledger.listInterruptedExecutions(
    input.limit ?? 100,
  );

  for (const candidate of interrupted) {
    const requireInspection = async (reasonCode: string) => {
      await input.ledger.markInterruptedInspectRequired(
        candidate.userId,
        candidate.id,
        reasonCode,
      );
      await input.continuations
        .discard(candidate.userId, candidate.id)
        .catch(() => undefined);
      result.inspectRequired.push(candidate.id);
    };

    if (candidate.crashRecovery !== "idempotent-retry") {
      await requireInspection("non-idempotent-interrupted-execution");
      continue;
    }

    const continuation = await input.continuations.load(
      candidate.userId,
      candidate.id,
    );
    if (!continuation) {
      await requireInspection("missing-private-continuation");
      continue;
    }

    const action = await input.ledger.get(candidate.userId, candidate.id);
    if (
      !continuationMatches(action, continuation) ||
      !continuation.actorClientId ||
      action.approval?.state !== "approved"
    ) {
      await requireInspection("invalid-private-continuation");
      continue;
    }

    let broker: ToolBroker;
    try {
      broker = await input.brokerForOwner(candidate.userId);
    } catch {
      result.deferred.push(candidate.id);
      continue;
    }
    const descriptor = broker.registry.resolve(
      continuation.toolId,
      continuation.toolVersion,
    );
    if (
      !descriptor ||
      descriptor.effect === "read" ||
      descriptor.crashRecovery !== "idempotent-retry" ||
      descriptor.requiredScopes.some(
        (scope) => !continuation.scopes.includes(scope),
      )
    ) {
      await requireInspection("tool-version-not-recoverable");
      continue;
    }

    await broker.invoke(
      broker.createRecoveryContext({
        principal: {
          userId: continuation.userId,
          clientId: continuation.actorClientId,
          scopes: new Set(continuation.scopes),
        },
        actionActorKind: continuation.actorKind,
        approvalMode: continuation.approvalMode,
        approvalProof: {
          proofId: action.approval.id,
          userId: continuation.userId,
          clientId: continuation.actorClientId,
          toolId: continuation.toolId,
          toolVersion: continuation.toolVersion,
          argumentsHash: continuation.argumentsHash,
          branchId: continuation.branchId,
          expiresAt: action.approval.expiresAt,
        },
        threadId: continuation.threadId,
        branchId: continuation.branchId,
        runId: continuation.runId,
        toolCallId: continuation.toolCallId,
        signal: new AbortController().signal,
        deadline: new Date(Date.now() + 30_000),
        capabilities: input.capabilities ?? noOpToolCapabilities,
        events: input.events ?? noOpToolEvents,
        actionLedger: new DurableToolActionLedgerWriter(
          input.ledger,
          continuation.actorKind,
          continuation.userId,
        ),
      }),
      {
        toolId: continuation.toolId,
        toolVersion: continuation.toolVersion,
        input: continuation.input,
        idempotencyKey: continuation.idempotencyKey,
      },
    );

    const recovered = await input.ledger.get(candidate.userId, candidate.id);
    if (recovered.status === "completed") result.resumed.push(candidate.id);
    else if (recovered.status === "inspect-required")
      result.inspectRequired.push(candidate.id);
    else if (["failed", "expired", "rejected"].includes(recovered.status))
      result.failed.push(candidate.id);
    else result.deferred.push(candidate.id);
  }

  return result;
}
