import { z } from "zod";
import type {
  AvermateAgentEventV1,
  StoredConversationEvent,
} from "./events";
import { MAX_AGENT_EVENT_REPLAY } from "./events";

export const conversationPlacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("core") }),
  z.strictObject({
    kind: z.literal("node"),
    nodeId: z.string().min(1).max(256),
  }),
]);
export type ConversationPlacement = z.infer<typeof conversationPlacementSchema>;

export const conversationRunStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting-approval",
  "finished",
  "failed",
  "cancelled",
  "placement-unavailable",
]);
export type ConversationRunStatus = z.infer<
  typeof conversationRunStatusSchema
>;

export const appendConversationEventSchema = z.strictObject({
  event: z.unknown(),
  expectedPreviousSequence: z.number().int().nonnegative(),
});
export type AppendConversationEvent = {
  event: AvermateAgentEventV1;
  expectedPreviousSequence: number;
};

export const replayConversationEventsSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  threadId: z.string().min(1).max(256),
  branchId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  afterSequence: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(MAX_AGENT_EVENT_REPLAY).default(250),
});
export type ReplayConversationEvents = z.infer<
  typeof replayConversationEventsSchema
>;

export const getConversationRunSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  threadId: z.string().min(1).max(256),
  branchId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
});
export type GetConversationRun = z.infer<typeof getConversationRunSchema>;

export const conversationRunRecordSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  threadId: z.string().min(1).max(256),
  branchId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  placement: conversationPlacementSchema,
  status: conversationRunStatusSchema,
  lastSequence: z.number().int().nonnegative(),
  terminalEventId: z.string().min(1).max(256).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ConversationRunRecord = z.infer<
  typeof conversationRunRecordSchema
>;

export interface ConversationStore {
  appendEvent(
    input: AppendConversationEvent,
  ): Promise<StoredConversationEvent>;
  replayEvents(
    input: ReplayConversationEvents,
  ): AsyncIterable<StoredConversationEvent>;
  getRun(input: GetConversationRun): Promise<ConversationRunRecord | null>;
}

export const nodeRelayCursorSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  threadId: z.string().min(1).max(256),
  branchId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  nodeId: z.string().min(1).max(256),
  acknowledgedSequence: z.number().int().nonnegative(),
  terminal: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type NodeRelayCursor = z.infer<typeof nodeRelayCursorSchema>;
