import { z } from "zod";
import {
  assistantDagExportSchema,
  assistantThreadDetailSchema,
  assistantThreadListItemSchema,
} from "./assistant";
import { storedConversationEventSchema } from "./events";

export const nodeConversationDagSnapshotSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  detail: assistantThreadDetailSchema,
  events: z.array(storedConversationEventSchema).max(100_000),
  syncKey: z.string().min(1).max(512),
});
export type NodeConversationDagSnapshot = z.infer<
  typeof nodeConversationDagSnapshotSchema
>;

export const nodeConversationDagListInputSchema = z.strictObject({
  query: z.string().max(500).optional(),
  projectId: z.string().min(1).max(256).optional(),
  includeArchived: z.boolean().default(false),
  includeDeleted: z.boolean().default(false),
  starredOnly: z.boolean().default(false),
  limit: z.number().int().positive().max(100).default(30),
});
export type NodeConversationDagListInput = z.infer<
  typeof nodeConversationDagListInputSchema
>;

export const nodeConversationDagListResultSchema = z.strictObject({
  items: z.array(assistantThreadListItemSchema).max(100),
});
export type NodeConversationDagListResult = z.infer<
  typeof nodeConversationDagListResultSchema
>;

export const nodeConversationDagGetInputSchema = z.strictObject({
  threadId: z.string().min(1).max(256),
});

export const nodeConversationDagGetResultSchema = z.strictObject({
  detail: assistantThreadDetailSchema,
  events: z.array(storedConversationEventSchema).max(100_000),
});
export type NodeConversationDagGetResult = z.infer<
  typeof nodeConversationDagGetResultSchema
>;

export const nodeConversationDagExportResultSchema = z.strictObject({
  dag: assistantDagExportSchema,
  events: z.array(storedConversationEventSchema).max(100_000),
});

export const nodeConversationDagDeleteResultSchema = z.strictObject({
  threadId: z.string().min(1).max(256),
  deleted: z.boolean(),
  alreadyAbsent: z.boolean(),
});
