import { z } from "zod";
import type { ContextManifest } from "./context";
import type { ConversationCheckpointRef } from "./references";
import {
  branchBoundaryRefsSchema,
  conversationCheckpointRefSchema,
} from "./references";

export const AGENT_RUNTIME_PROTOCOL_VERSION = 1 as const;

const opaqueId = z.string().min(1).max(256);
const revision = z.string().min(1).max(256);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.iso.datetime({ offset: true });

export const agentApprovalModeSchema = z.enum([
  "read-only",
  "confirm-writes",
  "auto-reversible",
]);
export type AgentApprovalMode = z.infer<typeof agentApprovalModeSchema>;

/**
 * Inference placement is immutable for one run. A public hosted Core never
 * represents a user's LAN endpoint as a Core placement; local/private model
 * origins are available only through the explicit Node variant.
 */
export const modelPlacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("direct-byok"),
    origin: z.url().refine((value) => value.startsWith("https://"), {
      message: "Hosted BYOK model origins must use public HTTPS",
    }),
    credentialOwner: z.literal("user"),
  }),
  z.strictObject({
    kind: z.literal("core"),
    instanceId: opaqueId,
  }),
  z.strictObject({
    kind: z.literal("node"),
    nodeId: opaqueId,
    capabilityRevision: revision,
  }),
  z.strictObject({
    kind: z.literal("managed"),
    pool: opaqueId,
    region: z.string().min(1).max(128),
  }),
]);
export type ModelPlacement = z.infer<typeof modelPlacementSchema>;

/** Immutable, fully resolved request persisted before a production run starts. */
export const agentRunRequestSchema = z.strictObject({
  protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
  ownerId: opaqueId,
  threadId: opaqueId,
  branchId: opaqueId,
  runId: opaqueId,
  inputMessageId: opaqueId,
  reservedOutputMessageId: opaqueId,
  conversationPlacement: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("core") }),
    z.strictObject({ kind: z.literal("node"), nodeId: opaqueId }),
  ]),
  modelKey: opaqueId,
  modelRevision: revision,
  providerKey: opaqueId,
  providerRevision: revision,
  modelPlacement: modelPlacementSchema,
  policyRevision: revision,
  toolCatalogRevision: revision,
  contextManifestDigest: digest,
  branchIdentityDigest: digest,
  graphSchemaVersion: z.number().int().positive(),
  approvalMode: agentApprovalModeSchema,
});
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;

export const agentRunLeaseStateSchema = z.enum([
  "active",
  "released",
  "expired",
  "fenced",
]);
export type AgentRunLeaseState = z.infer<typeof agentRunLeaseStateSchema>;

export const agentRunLeaseSchema = z.strictObject({
  protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
  id: opaqueId,
  ownerId: opaqueId,
  runId: opaqueId,
  workerId: opaqueId,
  fencingToken: z.number().int().positive(),
  state: agentRunLeaseStateSchema,
  acquiredAt: instant,
  heartbeatAt: instant,
  expiresAt: instant,
});
export type AgentRunLease = z.infer<typeof agentRunLeaseSchema>;

export const agentCheckpointRefSchema = z.strictObject({
  protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
  ownerId: opaqueId,
  threadId: opaqueId,
  branchId: opaqueId,
  runId: opaqueId,
  conversationCheckpointRef: conversationCheckpointRefSchema,
  afterEventSequence: z.number().int().nonnegative(),
  runtimeId: opaqueId,
  runtimeVersion: revision,
  graphSchemaVersion: z.number().int().positive(),
  stateDigest: digest,
});
export type AgentCheckpointRef = z.infer<typeof agentCheckpointRefSchema>;

export const providerDispatchClaimStateSchema = z.enum([
  "claimed",
  "dispatching",
  "acknowledged",
  "completed",
  "failed",
  "cancelled",
  "inspect-required",
]);
export type ProviderDispatchClaimState = z.infer<
  typeof providerDispatchClaimStateSchema
>;

export const providerDispatchClaimSchema = z.strictObject({
  protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
  id: opaqueId,
  ownerId: opaqueId,
  threadId: opaqueId,
  branchId: opaqueId,
  runId: opaqueId,
  dispatchKey: opaqueId,
  requestDigest: digest,
  providerKey: opaqueId,
  providerRevision: revision,
  modelKey: opaqueId,
  modelRevision: revision,
  placement: modelPlacementSchema,
  providerSupportsStableRequestKey: z.boolean(),
  stableRequestKey: opaqueId.nullable(),
  state: providerDispatchClaimStateSchema,
  claimedAt: instant,
  updatedAt: instant,
  inspectReason: z.string().min(1).max(1_000).nullable(),
});
export type ProviderDispatchClaim = z.infer<
  typeof providerDispatchClaimSchema
>;

export const agentTerminalReasonSchema = z.enum([
  "completed",
  "user-cancelled",
  "deadline-exceeded",
  "approval-rejected",
  "approval-expired",
  "provider-error",
  "provider-dispatch-unknown",
  "placement-unavailable",
  "model-unavailable",
  "policy-revision-mismatch",
  "tool-catalog-revision-mismatch",
  "checkpoint-corrupt",
  "quota-denied",
  "runtime-error",
]);
export type AgentTerminalReason = z.infer<typeof agentTerminalReasonSchema>;

export const agentRunInputSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  threadId: z.string().min(1).max(256),
  branchId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  graphSchemaVersion: z.string().min(1).max(128),
  contextManifest: z.unknown(),
  modelId: z.string().min(1).max(256),
});
export type AgentRunInput = Omit<
  z.infer<typeof agentRunInputSchema>,
  "contextManifest"
> & { contextManifest: ContextManifest };

export const agentResumeInputSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  conversationCheckpointRef: conversationCheckpointRefSchema,
  resumeValue: z.unknown(),
});
export type AgentResumeInput = z.infer<typeof agentResumeInputSchema>;

export const agentCancelInputSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  reason: z.string().min(1).max(1_000),
});
export type AgentCancelInput = z.infer<typeof agentCancelInputSchema>;

export const agentForkInputSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  sourceThreadId: z.string().min(1).max(256),
  sourceBranchId: z.string().min(1).max(256),
  targetBranchId: z.string().min(1).max(256),
  boundary: branchBoundaryRefsSchema,
  editedInput: z.string().min(1).max(2_000_000),
});
export type AgentForkInput = z.infer<typeof agentForkInputSchema>;

export const agentInspectInputSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
});
export type AgentInspectInput = z.infer<typeof agentInspectInputSchema>;

export const agentRuntimeStateSchema = z.strictObject({
  runId: z.string().min(1).max(256),
  phase: z.enum([
    "queued",
    "running",
    "interrupted",
    "finished",
    "failed",
    "cancelled",
  ]),
  graphSchemaVersion: z.string().min(1).max(128),
  boundary: branchBoundaryRefsSchema.optional(),
  interrupt: z.unknown().nullable(),
});
export type AgentRuntimeState = z.infer<typeof agentRuntimeStateSchema>;

export interface AgentRunHandle {
  runId: string;
  conversationCheckpointRef: ConversationCheckpointRef | null;
  completed: Promise<AgentRuntimeState>;
}

export interface AgentRuntime {
  start(input: AgentRunInput): Promise<AgentRunHandle>;
  resume(input: AgentResumeInput): Promise<AgentRunHandle>;
  cancel(input: AgentCancelInput): Promise<void>;
  fork(input: AgentForkInput): Promise<ConversationCheckpointRef>;
  inspect(input: AgentInspectInput): Promise<AgentRuntimeState>;
}
