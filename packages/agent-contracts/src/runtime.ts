import { z } from "zod";
import type { ContextManifest } from "./context";
import type { ConversationCheckpointRef } from "./references";
import {
  branchBoundaryRefsSchema,
  conversationCheckpointRefSchema,
} from "./references";

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
