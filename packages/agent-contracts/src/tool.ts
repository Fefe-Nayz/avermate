import { z } from "zod";
import type { AvermateAgentEventV1 } from "./events";
import type {
  AgentActionActorKind,
  AgentActionReservation,
  AgentActionResourceOperation,
} from "./action";

export const TOOL_DESCRIPTOR_VERSION = 1 as const;

export const toolEffectSchema = z.enum([
  "read",
  "create",
  "update",
  "delete",
  "external",
]);
export type ToolEffect = z.infer<typeof toolEffectSchema>;

export const toolRiskSchema = z.enum(["low", "medium", "high", "irreversible"]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;

export const approvalRequirementSchema = z.enum(["never", "policy", "always"]);
export type ApprovalRequirement = z.infer<typeof approvalRequirementSchema>;

export const toolBudgetSchema = z.strictObject({
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  maxDepth: z.number().int().positive().max(128),
  maxItems: z.number().int().positive().max(1_000_000),
});
export type ToolBudget = z.infer<typeof toolBudgetSchema>;

export const toolErrorCodeSchema = z.enum([
  "AUTHENTICATION_REQUIRED",
  "SCOPE_DENIED",
  "OWNERSHIP_DENIED",
  "INVALID_INPUT",
  "INPUT_BUDGET_EXCEEDED",
  "RESULT_BUDGET_EXCEEDED",
  "STALE_REVISION",
  "PROVIDER_MANAGED_FIELD",
  "CAPABILITY_MISSING",
  "APPROVAL_REQUIRED",
  "APPROVAL_INVALID",
  "IDEMPOTENCY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "OPERATION_PENDING",
  "INSPECT_REQUIRED",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "PROVIDER_RETRYABLE",
  "SOURCE_UNAVAILABLE",
  "SOURCE_SNAPSHOT_CHANGED",
  "SOURCE_PROTOCOL_ERROR",
  "TOOL_NOT_FOUND",
  "TOOL_VERSION_UNSUPPORTED",
  "EXECUTION_FAILED",
  "ACTION_LEDGER_REQUIRED",
  "LEGACY_MUTATION_DISABLED",
  "ACTION_REJECTED",
  "ACTION_EXPIRED",
  "ACTION_CONFLICT",
  "PREVIEW_STALE",
  "DEPENDENCY_CYCLE",
]);
export type ToolErrorCode = z.infer<typeof toolErrorCodeSchema>;

export const toolErrorSchema = z.strictObject({
  code: toolErrorCodeSchema,
  message: z.string().min(1).max(1_000),
  retryable: z.boolean(),
  actionId: z.string().min(1).max(256).optional(),
  approvalId: z.string().min(1).max(256).optional(),
  previewHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export type ToolError = z.infer<typeof toolErrorSchema>;

export const citationRefSchema = z.strictObject({
  sourceId: z.string().min(1).max(256),
  locator: z.string().min(1).max(1_000).nullable().default(null),
  title: z.string().min(1).max(500).nullable().default(null),
});
export type CitationRef = z.infer<typeof citationRefSchema>;

export const nextToolRefSchema = z.strictObject({
  toolId: z.string().min(1).max(256),
  reason: z.string().min(1).max(500),
});
export type NextToolRef = z.infer<typeof nextToolRefSchema>;

export function toolResultV1Schema<T extends z.ZodType>(dataSchema: T) {
  return z.strictObject({
    ok: z.boolean(),
    data: dataSchema.optional(),
    error: toolErrorSchema.optional(),
    citations: z.array(citationRefSchema).max(100).optional(),
    next: z.array(nextToolRefSchema).max(50).optional(),
    replayed: z.boolean().optional(),
    truncated: z.boolean().optional(),
  });
}

export type ToolResultV1<T> = {
  ok: boolean;
  data?: T;
  error?: ToolError;
  citations?: CitationRef[];
  next?: NextToolRef[];
  replayed?: boolean;
  truncated?: boolean;
};

export const toolPrincipalSchema = z.strictObject({
  userId: z.string().min(1).max(256),
  clientId: z.string().min(1).max(256),
  scopes: z.instanceof(Set<string>),
});
export type ToolPrincipal = z.infer<typeof toolPrincipalSchema>;

export const toolApprovalProofSchema = z.strictObject({
  proofId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
  clientId: z.string().min(1).max(256),
  toolId: z.string().min(1).max(256),
  toolVersion: z.number().int().positive(),
  argumentsHash: z.string().regex(/^[a-f0-9]{64}$/),
  branchId: z.string().min(1).max(256).nullable(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ToolApprovalProof = z.infer<typeof toolApprovalProofSchema>;

export interface ToolCapabilityResolver {
  has(capability: string): boolean | Promise<boolean>;
  placement(capability: string): "core" | "node" | "unavailable";
}

export type ToolBrokerEventKind =
  "queued" | "started" | "progress" | "result" | "error";

export interface ToolBrokerEvent {
  kind: ToolBrokerEventKind;
  toolId: string;
  toolVersion: number;
  toolCallId: string;
  emittedAt: string;
  payload: unknown;
}

export interface ToolEventSink {
  publish(event: ToolBrokerEvent): void | Promise<void>;
  /** Optional bridge for runtimes already writing plan-026 envelopes. */
  publishAgentEvent?(event: AvermateAgentEventV1): void | Promise<void>;
}

export interface ToolActionLedgerWriter {
  readonly kind: "noop" | "durable";
  prepare(input: {
    userId: string;
    actorKind: AgentActionActorKind;
    actorClientId: string | null;
    threadId: string | null;
    branchId: string | null;
    runId: string | null;
    toolCallId: string;
    toolId: string;
    toolVersion: number;
    effect: ToolEffect;
    risk: ToolRisk;
    approval: ApprovalRequirement;
    approvalMode:
      "read-only" | "confirm-writes" | "auto-reversible" | "auto" | "confirm";
    compensation: "none" | "supported" | "guaranteed";
    compensatorId: string | null;
    crashRecovery: "idempotent-retry" | "inspect-required";
    /** Trusted broker flag: atomically claim execution with reservation. */
    claimExecution?: boolean;
    /** Trusted recovery worker flag; never sourced from model tool input. */
    resumeInterrupted?: boolean;
    idempotencyKey: string;
    argumentsHash: string;
    redactedInput: unknown;
    preview: unknown;
    domainScopeKind: string | null;
    domainScopeId: string | null;
    batchId: string | null;
  }): Promise<AgentActionReservation>;
  markExecuting(reference: string): Promise<void>;
  complete(
    reference: string,
    input: {
      modelProjection: unknown;
      uiProjection: unknown;
      auditProjection: unknown;
      resources: Array<{
        resourceKind: string;
        resourceId: string;
        operation: AgentActionResourceOperation;
        beforeRevision: string | null;
        afterRevision: string | null;
        beforeSnapshot?: unknown;
        afterSnapshot?: unknown;
        contentRefBefore?: string | null;
        contentRefAfter?: string | null;
      }>;
    },
  ): Promise<void>;
  fail(
    reference: string,
    error: ToolError,
    effectMayHaveOccurred: boolean,
  ): Promise<void>;
}

export interface ToolExecutionContext {
  principal: ToolPrincipal;
  /** Trusted transport identity; never accepted from tool/model input. */
  actionActorKind: AgentActionActorKind;
  approvalMode:
    "read-only" | "confirm-writes" | "auto-reversible" | "auto" | "confirm";
  approvalProof: ToolApprovalProof | null;
  threadId: string | null;
  branchId: string | null;
  runId: string | null;
  toolCallId: string;
  signal: AbortSignal;
  deadline: Date;
  capabilities: ToolCapabilityResolver;
  events: ToolEventSink;
  actionLedger: ToolActionLedgerWriter;
  /** Set only by ToolBroker after a durable reservation. */
  actionReference: string | null;
}

export interface ResultProjection<O, P> {
  schema: z.ZodType<P>;
  budget: ToolBudget;
  project(output: O): P;
}

export interface AvermateToolDescriptor<I, O, M, U, A> {
  id: string;
  version: number;
  title: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  requiredScopes: readonly string[];
  effect: ToolEffect;
  risk: ToolRisk;
  approval: ApprovalRequirement;
  idempotency: "none" | "optional" | "required";
  preview: "none" | "supported" | "required";
  compensation: "none" | "supported" | "guaranteed";
  compensatorId?: string;
  crashRecovery?: "idempotent-retry" | "inspect-required";
  inputBudget: ToolBudget;
  resultBudget: ToolBudget;
  redact(input: I): unknown;
  previewInput?(input: I): unknown;
  buildActionPreview?(
    context: ToolExecutionContext,
    input: I,
  ): unknown | Promise<unknown>;
  actionScope?(input: I): {
    kind: string;
    id: string;
  } | null;
  actionResources?(
    input: I,
    output: O,
  ): Array<{
    resourceKind: string;
    resourceId: string;
    operation: AgentActionResourceOperation;
    beforeRevision: string | null;
    afterRevision: string | null;
    beforeSnapshot?: unknown;
    afterSnapshot?: unknown;
    contentRefBefore?: string | null;
    contentRefAfter?: string | null;
  }>;
  execute(context: ToolExecutionContext, input: I): Promise<O>;
  resultProjections: {
    model: ResultProjection<O, M>;
    ui: ResultProjection<O, U>;
    audit: ResultProjection<O, A>;
  };
}

export type AnyAvermateToolDescriptor = AvermateToolDescriptor<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>;

export const opaqueFileHandleSchema = z
  .string()
  .regex(/^fh1\.[A-Za-z0-9_-]{32,4096}$/)
  .brand<"OpaqueFileHandle">();
export type OpaqueFileHandle = z.infer<typeof opaqueFileHandleSchema>;

export const fileHandleAudienceSchema = z.enum(["preview", "download"]);
export type FileHandleAudience = z.infer<typeof fileHandleAudienceSchema>;

export const fileHandleProjectionSchema = z.strictObject({
  handle: opaqueFileHandleSchema,
  audience: fileHandleAudienceSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  mimeType: z.string().min(1).max(256),
  byteSize: z.number().int().nonnegative(),
});
export type FileHandleProjection = z.infer<typeof fileHandleProjectionSchema>;
