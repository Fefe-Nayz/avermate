import { z } from "zod";

const opaqueReference = <T extends string>(brand: T) =>
  z.string().min(1).max(512).brand<T>();

export const conversationCheckpointRefSchema = opaqueReference(
  "ConversationCheckpointRef",
);
export const workspaceSnapshotRefSchema = opaqueReference("WorkspaceSnapshotRef");
export const sandboxRuntimeCheckpointRefSchema = opaqueReference(
  "SandboxRuntimeCheckpointRef",
);
export const domainCursorRefSchema = opaqueReference("DomainCursorRef");

export type ConversationCheckpointRef = z.infer<
  typeof conversationCheckpointRefSchema
>;
export type WorkspaceSnapshotRef = z.infer<typeof workspaceSnapshotRefSchema>;
export type SandboxRuntimeCheckpointRef = z.infer<
  typeof sandboxRuntimeCheckpointRefSchema
>;
export type DomainCursorRef = z.infer<typeof domainCursorRefSchema>;

export const branchBoundaryRefsSchema = z
  .strictObject({
    conversationCheckpointRef: conversationCheckpointRefSchema.optional(),
    workspaceSnapshotRef: workspaceSnapshotRefSchema.optional(),
    sandboxRuntimeCheckpointRef:
      sandboxRuntimeCheckpointRefSchema.optional(),
    domainCursorRef: domainCursorRefSchema.optional(),
  })
  .refine((value) => Object.values(value).some(Boolean), {
    message: "A branch boundary must reference at least one durable history",
  });

export type BranchBoundaryRefs = z.infer<typeof branchBoundaryRefsSchema>;
