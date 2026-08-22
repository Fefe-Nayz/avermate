import { z } from "zod";

export const contextTrustSchema = z.enum([
  "system-policy",
  "user-instruction",
  "application-data",
  "retrieved-untrusted",
  "tool-result",
]);
export type ContextTrust = z.infer<typeof contextTrustSchema>;

export const contextBlockSchema = z.strictObject({
  id: z.string().min(1).max(256),
  trust: contextTrustSchema,
  mediaType: z.string().min(1).max(256),
  content: z.string().max(2_000_000),
  sourceRef: z.string().min(1).max(512).nullable(),
  redactions: z.array(z.string().min(1).max(256)).max(1_000).default([]),
});
export type ContextBlock = z.infer<typeof contextBlockSchema>;

export const agentPolicySnapshotSchema = z.strictObject({
  policyVersion: z.string().min(1).max(128),
  approvalMode: z.enum(["auto-read", "confirm-medium", "confirm-all"]),
  grantedScopes: z.array(z.string().min(1).max(256)).max(1_000),
  deniedScopes: z.array(z.string().min(1).max(256)).max(1_000),
  allowedModelOrigins: z.array(z.url()).max(100),
});
export type AgentPolicySnapshot = z.infer<typeof agentPolicySnapshotSchema>;

export const contextManifestSchema = z.strictObject({
  manifestVersion: z.literal(1),
  policy: agentPolicySnapshotSchema,
  blocks: z.array(contextBlockSchema).max(10_000),
});
export type ContextManifest = z.infer<typeof contextManifestSchema>;

export function createContextManifest(input: ContextManifest): ContextManifest {
  return contextManifestSchema.parse(input);
}
