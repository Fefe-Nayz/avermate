import type { AssistantRun } from "@avermate/agent-contracts"

/** Exact plan-035 metadata shared by assistant projection fixtures. */
export const assistantRunExecutionFixture = {
  runtimeProtocolVersion: 1,
  modelRevision: "mock/1",
  providerRevision: "mock/1",
  modelPlacement: { kind: "core", instanceId: "test-core" },
  policyRevision: "assistant-policy/1",
  toolCatalogRevision: "sha256:test-catalogue",
  contextManifestDigest: null,
  branchIdentityDigest: null,
  cancellationRequestedAt: null,
  cancellationReason: null,
  terminalReason: null,
} satisfies Pick<
  AssistantRun,
  | "runtimeProtocolVersion"
  | "modelRevision"
  | "providerRevision"
  | "modelPlacement"
  | "policyRevision"
  | "toolCatalogRevision"
  | "contextManifestDigest"
  | "branchIdentityDigest"
  | "cancellationRequestedAt"
  | "cancellationReason"
  | "terminalReason"
>
