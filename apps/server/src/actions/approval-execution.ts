import type {
  AgentActionDto,
  ToolCapabilityResolver,
  ToolError,
  ToolEventSink,
} from "@avermate/agent-contracts";
import {
  DurableToolActionLedgerWriter,
  type ActionLedgerService,
} from "./action-ledger";
import {
  type ToolActionContinuation,
  type ToolActionContinuationStore,
} from "../tools/action-continuation";
import {
  noOpToolCapabilities,
  noOpToolEvents,
  type ToolBroker,
} from "../tools/broker";

type ApprovalResolution = {
  actionId: string;
  approvalId: string;
  previewHash: string;
  decision: "approve" | "reject";
};

export function continuationMatches(
  action: AgentActionDto,
  continuation: ToolActionContinuation,
): boolean {
  return (
    action.id === continuation.actionId &&
    action.userId === continuation.userId &&
    action.actorKind === continuation.actorKind &&
    action.actorClientId === continuation.actorClientId &&
    action.threadId === continuation.threadId &&
    action.branchId === continuation.branchId &&
    action.runId === continuation.runId &&
    action.toolCallId === continuation.toolCallId &&
    action.toolId === continuation.toolId &&
    action.toolVersion === continuation.toolVersion &&
    action.idempotencyKey === continuation.idempotencyKey &&
    action.argumentsHash === continuation.argumentsHash &&
    action.previewHash === continuation.previewHash &&
    action.approval?.previewHash === continuation.previewHash
  );
}

async function failMissingContinuation(
  ledger: ActionLedgerService,
  userId: string,
  actionId: string,
  message: string,
): Promise<AgentActionDto> {
  const error: ToolError = {
    code: "EXECUTION_FAILED",
    message,
    retryable: false,
  };
  await ledger.fail(userId, actionId, error, false);
  return ledger.get(userId, actionId);
}

/**
 * Resolve an exact approval and, on approval, continue the already-reserved
 * action from its private sealed arguments. The caller never receives or
 * re-submits raw arguments, which prevents UI drift and secret leakage.
 */
export async function resolveApprovalAndResume(input: {
  ledger: ActionLedgerService;
  broker: ToolBroker;
  userId: string;
  resolution: ApprovalResolution;
  resolutionContext: unknown;
  authorizedScopes?: ReadonlySet<string> | null;
  capabilities?: ToolCapabilityResolver;
  events?: ToolEventSink;
  continuations?: ToolActionContinuationStore;
}): Promise<AgentActionDto> {
  const continuations =
    input.continuations ??
    (await import("../tools/managed-action-continuation"))
      .managedToolActionContinuationStore;
  const resolved = await input.ledger.resolveApproval({
    userId: input.userId,
    ...input.resolution,
    resolutionContext: input.resolutionContext,
  });

  if (input.resolution.decision === "reject") {
    await continuations
      .discard(input.userId, input.resolution.actionId)
      .catch(() => undefined);
    return resolved;
  }
  if (resolved.status !== "reserved") {
    if (
      ["completed", "failed", "rejected", "expired", "inspect-required"].includes(
        resolved.status,
      )
    ) {
      await continuations
        .discard(input.userId, input.resolution.actionId)
        .catch(() => undefined);
    }
    return resolved;
  }

  const continuation = await continuations.load(
    input.userId,
    input.resolution.actionId,
  );
  if (!continuation || !continuationMatches(resolved, continuation)) {
    await continuations
      .discard(input.userId, input.resolution.actionId)
      .catch(() => undefined);
    return failMissingContinuation(
      input.ledger,
      input.userId,
      input.resolution.actionId,
      "The approved action continuation is unavailable or does not match its immutable reservation",
    );
  }
  const descriptor = input.broker.registry.resolve(
    continuation.toolId,
    continuation.toolVersion,
  );
  if (!descriptor || descriptor.effect === "read") {
    return failMissingContinuation(
      input.ledger,
      input.userId,
      input.resolution.actionId,
      "The approved action tool version is no longer available",
    );
  }
  if (
    descriptor.requiredScopes.some(
      (scope) =>
        !continuation.scopes.includes(scope) ||
        (input.authorizedScopes && !input.authorizedScopes.has(scope)),
    )
  ) {
    return failMissingContinuation(
      input.ledger,
      input.userId,
      input.resolution.actionId,
      "The approving session no longer grants the reserved tool scopes",
    );
  }
  if (!continuation.actorClientId) {
    return failMissingContinuation(
      input.ledger,
      input.userId,
      input.resolution.actionId,
      "The approved action has no trusted client binding",
    );
  }

  await input.broker.invoke(
    input.broker.createContext({
      principal: {
        userId: continuation.userId,
        clientId: continuation.actorClientId,
        scopes: new Set(continuation.scopes),
      },
      actionActorKind: continuation.actorKind,
      approvalMode: continuation.approvalMode,
      approvalProof: {
        proofId: input.resolution.approvalId,
        userId: continuation.userId,
        clientId: continuation.actorClientId,
        toolId: continuation.toolId,
        toolVersion: continuation.toolVersion,
        argumentsHash: continuation.argumentsHash,
        branchId: continuation.branchId,
        expiresAt: continuation.expiresAt,
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
  return input.ledger.get(input.userId, input.resolution.actionId);
}
