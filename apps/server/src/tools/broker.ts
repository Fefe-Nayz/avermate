import type {
  ToolApprovalProof,
  ToolError,
  ToolErrorCode,
  ToolExecutionContext,
  ToolResultV1,
} from "@avermate/agent-contracts";
import {
  BudgetExceededError,
  assertProjectionSafe,
  enforceBudget,
} from "./budgets";
import type {
  PersistedProjectionBundle,
  ToolOperationStore,
} from "./idempotency";
import { MemoryToolOperationStore } from "./idempotency";
import { ToolRegistry } from "./registry";
import type { ToolActionContinuationStore } from "./action-continuation";

const reservedAuthorityFields = new Set([
  "userId",
  "clientId",
  "scope",
  "scopes",
  "risk",
  "approval",
  "approvalMode",
  "role",
  "providerCredential",
  "executionPlacement",
  "egressPolicy",
]);

const retryableCodes = new Set<ToolErrorCode>([
  "RATE_LIMITED",
  "PROVIDER_RETRYABLE",
  "SOURCE_UNAVAILABLE",
  "DEADLINE_EXCEEDED",
]);

export class ToolBrokerFault extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly details: Partial<ToolError> = {},
  ) {
    super(message);
    this.name = "ToolBrokerFault";
  }
}

export type ToolBrokerResult = {
  model: ToolResultV1<unknown>;
  ui: ToolResultV1<unknown>;
  audit: ToolResultV1<unknown>;
  actionLedgerRef: string | null;
};
type ProjectionResult = ToolBrokerResult;

export type ToolBrokerInvocation = {
  toolId: string;
  toolVersion: number;
  input: unknown;
  idempotencyKey?: string;
};

type ContextInput = Omit<
  ToolExecutionContext,
  "approvalProof" | "actionReference" | "actionActorKind"
> & {
  approvalProof?: ToolApprovalProof | null;
  actionActorKind?: ToolExecutionContext["actionActorKind"];
};

function safeMessage(code: ToolErrorCode): string {
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
      return "Authentication is required.";
    case "SCOPE_DENIED":
      return "The session does not grant this capability.";
    case "OWNERSHIP_DENIED":
      return "The requested resource is unavailable.";
    case "APPROVAL_REQUIRED":
      return "This operation requires explicit approval.";
    case "APPROVAL_INVALID":
      return "The approval does not match this exact operation.";
    case "IDEMPOTENCY_CONFLICT":
      return "That idempotency key was used for different arguments.";
    case "OPERATION_PENDING":
    case "INSPECT_REQUIRED":
      return "Inspect the resource before attempting this operation again.";
    case "CANCELLED":
      return "The operation was cancelled.";
    case "DEADLINE_EXCEEDED":
      return "The operation exceeded its deadline.";
    default:
      return "The tool operation could not be completed.";
  }
}

function errorResult(error: ToolError): ProjectionResult {
  const envelope = { ok: false, error } as const;
  return {
    model: envelope,
    ui: envelope,
    audit: envelope,
    actionLedgerRef: null,
  };
}

function hashInput(value: unknown): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))
    .then((bytes) =>
      [...new Uint8Array(bytes)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    );
}

function authorityKey(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return (
    Object.keys(input).find((key) => reservedAuthorityFields.has(key)) ?? null
  );
}

function mapUnknownError(error: unknown): ToolError {
  if (error instanceof ToolBrokerFault) {
    return {
      code: error.code,
      message: safeMessage(error.code),
      retryable: retryableCodes.has(error.code),
      ...error.details,
    };
  }
  if (error instanceof BudgetExceededError) {
    return {
      code: "RESULT_BUDGET_EXCEEDED",
      message: safeMessage("RESULT_BUDGET_EXCEEDED"),
      retryable: false,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "CANCELLED",
      message: safeMessage("CANCELLED"),
      retryable: false,
    };
  }
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const errorName =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  const mapped: ToolErrorCode =
    code === "NOT_FOUND" ||
    code === "FORBIDDEN" ||
    code === "not-found" ||
    code === "forbidden"
      ? "OWNERSHIP_DENIED"
      : code === "TOO_MANY_REQUESTS"
        ? "RATE_LIMITED"
        : code === "conflict" && errorName === "ActionLedgerError"
          ? "IDEMPOTENCY_CONFLICT"
          : code === "CONFLICT" || code === "conflict"
            ? "STALE_REVISION"
            : code === "preview-stale"
              ? "PREVIEW_STALE"
              : code === "dependency-pending"
                ? "OPERATION_PENDING"
                : code === "dependency-cycle"
                  ? "DEPENDENCY_CYCLE"
                  : code === "invalid-state"
                    ? "ACTION_CONFLICT"
                    : "EXECUTION_FAILED";
  return {
    code: mapped,
    message: safeMessage(mapped),
    retryable: retryableCodes.has(mapped),
  };
}

export class ToolBroker {
  readonly #trustedContexts = new WeakSet<ToolExecutionContext>();
  readonly #recoveryContexts = new WeakSet<ToolExecutionContext>();

  constructor(
    readonly registry: ToolRegistry,
    private readonly operations: ToolOperationStore = new MemoryToolOperationStore(),
    private readonly persist: (input: {
      context: ToolExecutionContext;
      ui: unknown;
      audit: unknown;
    }) => Promise<void> = async () => undefined,
    private readonly continuations: ToolActionContinuationStore | null = null,
  ) {}

  createContext(input: ContextInput): ToolExecutionContext {
    const context: ToolExecutionContext = {
      ...input,
      approvalProof: input.approvalProof ?? null,
      actionActorKind:
        input.actionActorKind ?? (input.threadId ? "embedded-agent" : "mcp"),
      actionReference: null,
      principal: {
        ...input.principal,
        scopes: new Set(input.principal.scopes),
      },
    };
    this.#trustedContexts.add(context);
    return context;
  }

  /** Minted only by a trusted restart reconciler, never from tool arguments. */
  createRecoveryContext(input: ContextInput): ToolExecutionContext {
    const context = this.createContext(input);
    this.#recoveryContexts.add(context);
    return context;
  }

  async invoke(
    context: ToolExecutionContext,
    invocation: ToolBrokerInvocation,
  ): Promise<ProjectionResult> {
    if (!this.#trustedContexts.has(context)) {
      return errorResult({
        code: "AUTHENTICATION_REQUIRED",
        message: safeMessage("AUTHENTICATION_REQUIRED"),
        retryable: false,
      });
    }
    const descriptor = this.registry.resolve(
      invocation.toolId,
      invocation.toolVersion,
    );
    if (!descriptor) {
      return errorResult({
        code: "TOOL_NOT_FOUND",
        message: safeMessage("TOOL_NOT_FOUND"),
        retryable: false,
      });
    }

    let reservationRef: string | null = null;
    let ledgerRef: string | null = null;
    let redactedInput: unknown = null;
    let executionStarted = false;
    let descriptorCrashRecovery: "idempotent-retry" | "inspect-required" =
      "inspect-required";
    try {
      if (!context.principal.userId || !context.principal.clientId) {
        throw new ToolBrokerFault(
          "AUTHENTICATION_REQUIRED",
          "missing principal",
        );
      }
      const injected = authorityKey(invocation.input);
      if (injected) {
        throw new ToolBrokerFault(
          "INVALID_INPUT",
          `untrusted authority field: ${injected}`,
        );
      }
      try {
        enforceBudget(invocation.input, descriptor.inputBudget);
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          throw new ToolBrokerFault("INPUT_BUDGET_EXCEEDED", error.message);
        }
        throw error;
      }
      const parsed = descriptor.inputSchema.parse(invocation.input);
      for (const scope of descriptor.requiredScopes) {
        if (!context.principal.scopes.has(scope)) {
          throw new ToolBrokerFault("SCOPE_DENIED", `missing scope: ${scope}`);
        }
      }
      if (context.signal.aborted) throw context.signal.reason;
      if (Date.now() >= context.deadline.getTime()) {
        throw new ToolBrokerFault("DEADLINE_EXCEEDED", "deadline elapsed");
      }
      const argumentsHash = await hashInput(parsed);
      const isMutation = descriptor.effect !== "read";
      descriptorCrashRecovery = descriptor.crashRecovery ?? "inspect-required";
      if (
        isMutation &&
        (descriptor.effect === "external" ||
          /^(?:admin|provider|connections?|sync|custom|external)\./.test(
            descriptor.id,
          ))
      ) {
        throw new ToolBrokerFault(
          "CAPABILITY_MISSING",
          "External, provider, credential and administrative writes are not enabled",
        );
      }
      if (descriptor.idempotency === "required" && !invocation.idempotencyKey) {
        throw new ToolBrokerFault(
          "IDEMPOTENCY_REQUIRED",
          "missing idempotency key",
        );
      }
      if (
        !isMutation &&
        invocation.idempotencyKey &&
        descriptor.idempotency !== "none"
      ) {
        const reservation = await this.operations.reserve({
          userId: context.principal.userId,
          toolId: descriptor.id,
          toolVersion: descriptor.version,
          branchId: context.branchId,
          idempotencyKey: invocation.idempotencyKey,
          argumentsHash,
        });
        if (reservation.state === "replayed") {
          return {
            model: {
              ok: true,
              data: reservation.projections.model,
              replayed: true,
            },
            ui: { ok: true, data: reservation.projections.ui, replayed: true },
            audit: {
              ok: true,
              data: reservation.projections.audit,
              replayed: true,
            },
            actionLedgerRef: null,
          };
        }
        if (reservation.state !== "new") {
          throw new ToolBrokerFault(
            reservation.state === "conflict"
              ? "IDEMPOTENCY_CONFLICT"
              : reservation.state === "pending"
                ? "OPERATION_PENDING"
                : "INSPECT_REQUIRED",
            reservation.state,
          );
        }
        reservationRef = reservation.reference;
      }

      redactedInput = descriptor.redact(parsed);
      enforceBudget(redactedInput, descriptor.inputBudget);
      const preview =
        descriptor.preview === "none"
          ? null
          : descriptor.buildActionPreview
            ? await descriptor.buildActionPreview(context, parsed)
            : (descriptor.previewInput?.(parsed) ?? redactedInput);
      enforceBudget(preview, descriptor.inputBudget);
      if (isMutation) {
        if (context.actionLedger.kind !== "durable") {
          throw new ToolBrokerFault(
            "ACTION_LEDGER_REQUIRED",
            "Mutations require the durable action ledger",
          );
        }
        if (!invocation.idempotencyKey) {
          throw new ToolBrokerFault(
            "IDEMPOTENCY_REQUIRED",
            "A mutation idempotency key is required",
          );
        }
        const scope = descriptor.actionScope?.(parsed) ?? null;
        const reservation = await context.actionLedger.prepare({
          userId: context.principal.userId,
          actorKind: context.actionActorKind,
          actorClientId: context.principal.clientId,
          threadId: context.threadId,
          branchId: context.branchId,
          runId: context.runId,
          toolCallId: context.toolCallId,
          toolId: descriptor.id,
          toolVersion: descriptor.version,
          effect: descriptor.effect,
          risk: descriptor.risk,
          approval: descriptor.approval,
          approvalMode: context.approvalMode,
          compensation: descriptor.compensation,
          compensatorId: descriptor.compensatorId ?? null,
          crashRecovery: descriptorCrashRecovery,
          claimExecution: true,
          resumeInterrupted: this.#recoveryContexts.has(context),
          idempotencyKey: invocation.idempotencyKey,
          argumentsHash,
          redactedInput,
          preview,
          domainScopeKind: scope?.kind ?? null,
          domainScopeId: scope?.id ?? null,
          batchId: null,
        });
        ledgerRef = reservation.actionId;
        context.actionReference = reservation.actionId;
        if (reservation.state === "completed") {
          await this.continuations
            ?.discard(context.principal.userId, reservation.actionId)
            .catch(() => undefined);
          return {
            model: {
              ok: true,
              data: reservation.modelProjection,
              replayed: true,
            },
            ui: { ok: true, data: reservation.uiProjection, replayed: true },
            audit: {
              ok: true,
              data: reservation.auditProjection,
              replayed: true,
            },
            actionLedgerRef: reservation.actionId,
          };
        }
        if (reservation.state === "awaiting-approval") {
          if (this.continuations) {
            await this.continuations.stage({
              version: 1,
              actionId: reservation.actionId,
              userId: context.principal.userId,
              actorKind: context.actionActorKind,
              actorClientId: context.principal.clientId,
              scopes: [...context.principal.scopes].sort(),
              approvalMode:
                context.approvalMode === "read-only"
                  ? "confirm-writes"
                  : context.approvalMode,
              threadId: context.threadId,
              branchId: context.branchId,
              runId: context.runId,
              toolCallId: context.toolCallId,
              toolId: descriptor.id,
              toolVersion: descriptor.version,
              idempotencyKey: invocation.idempotencyKey!,
              argumentsHash,
              previewHash: reservation.previewHash,
              expiresAt: reservation.expiresAt,
              input: parsed,
            });
          }
          throw new ToolBrokerFault("APPROVAL_REQUIRED", "approval required", {
            actionId: reservation.actionId,
            approvalId: reservation.approvalId,
            previewHash: reservation.previewHash,
            expiresAt: reservation.expiresAt,
          });
        }
        if (reservation.state === "terminal") {
          await this.continuations
            ?.discard(context.principal.userId, reservation.actionId)
            .catch(() => undefined);
          const code =
            reservation.status === "rejected"
              ? "ACTION_REJECTED"
              : reservation.status === "expired"
                ? "ACTION_EXPIRED"
                : reservation.status === "inspect-required"
                  ? "INSPECT_REQUIRED"
                  : "EXECUTION_FAILED";
          throw new ToolBrokerFault(code, reservation.safeError ?? code, {
            actionId: reservation.actionId,
          });
        }
      }
      await context.events.publish({
        kind: "queued",
        toolId: descriptor.id,
        toolVersion: descriptor.version,
        toolCallId: context.toolCallId,
        emittedAt: new Date().toISOString(),
        payload: {
          preview,
          actionLedgerRef: ledgerRef,
        },
      });
      if (ledgerRef) await context.actionLedger.markExecuting(ledgerRef);
      await context.events.publish({
        kind: "started",
        toolId: descriptor.id,
        toolVersion: descriptor.version,
        toolCallId: context.toolCallId,
        emittedAt: new Date().toISOString(),
        payload: {},
      });

      const startedAt = performance.now();
      executionStarted = true;
      const raw = await descriptor.execute(context, parsed);
      const output = descriptor.outputSchema.parse(raw);
      enforceBudget(output, descriptor.resultBudget);
      const model = descriptor.resultProjections.model.schema.parse(
        descriptor.resultProjections.model.project(output),
      );
      const ui = descriptor.resultProjections.ui.schema.parse(
        descriptor.resultProjections.ui.project(output),
      );
      const audit = descriptor.resultProjections.audit.schema.parse(
        descriptor.resultProjections.audit.project(output),
      );
      enforceBudget(model, descriptor.resultProjections.model.budget);
      enforceBudget(ui, descriptor.resultProjections.ui.budget);
      enforceBudget(audit, descriptor.resultProjections.audit.budget);
      assertProjectionSafe(model);
      assertProjectionSafe(ui);
      assertProjectionSafe(audit);

      await this.persist({ context, ui, audit });
      if (ledgerRef) {
        await context.actionLedger.complete(ledgerRef, {
          modelProjection: model,
          uiProjection: ui,
          auditProjection: audit,
          resources: descriptor.actionResources?.(parsed, output) ?? [],
        });
        await this.continuations
          ?.discard(context.principal.userId, ledgerRef)
          .catch(() => undefined);
      }
      const bundle: PersistedProjectionBundle = { model, ui, audit };
      if (reservationRef)
        await this.operations.complete(reservationRef, bundle);
      await context.events.publish({
        kind: "result",
        toolId: descriptor.id,
        toolVersion: descriptor.version,
        toolCallId: context.toolCallId,
        emittedAt: new Date().toISOString(),
        payload: {
          ui,
          durationMs: Math.max(0, performance.now() - startedAt),
          actionLedgerRef: ledgerRef,
        },
      });
      return {
        model: { ok: true, data: model },
        ui: { ok: true, data: ui },
        audit: { ok: true, data: audit },
        actionLedgerRef: ledgerRef,
      };
    } catch (unknownError) {
      const error = mapUnknownError(unknownError);
      if (reservationRef) await this.operations.inspectRequired(reservationRef);
      if (ledgerRef) {
        await context.actionLedger
          .fail(
            ledgerRef,
            error,
            executionStarted && descriptorCrashRecovery === "inspect-required",
          )
          .catch(() => undefined);
        if (
          error.code !== "APPROVAL_REQUIRED" &&
          error.code !== "OPERATION_PENDING"
        ) {
          await this.continuations
            ?.discard(context.principal.userId, ledgerRef)
            .catch(() => undefined);
        }
      }
      await Promise.resolve(
        context.events.publish({
          kind: "error",
          toolId: invocation.toolId,
          toolVersion: invocation.toolVersion,
          toolCallId: context.toolCallId,
          emittedAt: new Date().toISOString(),
          payload: { error, redactedInput },
        }),
      ).catch(() => undefined);
      return errorResult(error);
    }
  }
}

export const noOpToolCapabilities = {
  has: () => false,
  placement: () => "unavailable" as const,
};
export const noOpToolEvents = { publish: async () => undefined };
export const noOpActionLedger = {
  kind: "noop" as const,
  prepare: async () => {
    throw new ToolBrokerFault(
      "ACTION_LEDGER_REQUIRED",
      "Durable action ledger is unavailable",
    );
  },
  markExecuting: async () => undefined,
  complete: async () => undefined,
  fail: async () => undefined,
};
