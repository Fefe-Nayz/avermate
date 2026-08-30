import {
  capabilityKindSchema,
  capabilityPolicyConstraintsSchema,
  capabilityPurposeSchema,
  type CapabilityKind,
  type CapabilityPolicy,
  type CapabilityPolicyConstraints,
  type CapabilityPolicyMode,
} from "@avermate/agent-contracts";
import { capabilityDigest } from "./values";

const egressOrder = [
  "none",
  "owner-node",
  "avermate-managed",
  "external-provider",
] as const;

const scopeRank: Record<CapabilityPolicy["scope"]["kind"], number> = {
  instance: 0,
  "managed-plan": 1,
  user: 2,
  project: 3,
  workflow: 4,
};

export type CapabilityPolicyResolutionContext = {
  ownerId: string;
  instanceId?: string;
  managedPlanId?: string;
  projectId?: string;
  workflowId?: string;
};

export type CapabilityOperationPolicyOverride = {
  mode?: CapabilityPolicyMode;
  pinnedOfferingId?: string;
  constraints?: Partial<CapabilityPolicyConstraints>;
};

export type ResolvedCapabilityPolicySnapshot = {
  version: 1;
  ownerId: string;
  capability: CapabilityKind;
  purpose: string;
  mode: CapabilityPolicyMode;
  primaryOfferingId: string | null;
  fallbackOfferingIds: string[];
  constraints: CapabilityPolicyConstraints;
  systemPolicyEpoch: `sha256:${string}`;
  appliedPolicies: Array<{ id: string; revision: number; scopeKind: string }>;
  digest: `sha256:${string}`;
};

function purposeMatches(pattern: string, purpose: string) {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return purpose.startsWith(pattern.slice(0, -1));
  }
  return pattern === purpose;
}

function scopeMatches(
  policy: CapabilityPolicy,
  context: CapabilityPolicyResolutionContext,
) {
  switch (policy.scope.kind) {
    case "instance":
      return policy.scope.id === context.instanceId;
    case "managed-plan":
      return policy.scope.id === context.managedPlanId;
    case "user":
      return policy.scope.id === context.ownerId;
    case "project":
      return policy.scope.id === context.projectId;
    case "workflow":
      return policy.scope.id === context.workflowId;
  }
}

function intersect<T>(left: readonly T[], right: readonly T[]): T[] {
  const allowed = new Set(right);
  return left.filter((value) => allowed.has(value));
}

function mostRestrictiveEgress(
  left: CapabilityPolicyConstraints["maximumDataEgress"],
  right: CapabilityPolicyConstraints["maximumDataEgress"],
) {
  return egressOrder[
    Math.min(egressOrder.indexOf(left), egressOrder.indexOf(right))
  ]!;
}

function mergeConstraints(
  current: CapabilityPolicyConstraints,
  next: CapabilityPolicyConstraints,
): CapabilityPolicyConstraints {
  const allowedProviders =
    current.allowedProviders === null
      ? next.allowedProviders
      : next.allowedProviders === null
        ? current.allowedProviders
        : intersect(current.allowedProviders, next.allowedProviders);
  return capabilityPolicyConstraintsSchema.parse({
    requiredFeatures: [
      ...new Set([...current.requiredFeatures, ...next.requiredFeatures]),
    ].sort(),
    allowedPlacements: intersect(
      current.allowedPlacements,
      next.allowedPlacements,
    ),
    allowedProviders,
    deniedProviders: [
      ...new Set([...current.deniedProviders, ...next.deniedProviders]),
    ].sort(),
    maximumDataEgress: mostRestrictiveEgress(
      current.maximumDataEgress,
      next.maximumDataEgress,
    ),
    allowPrivacyEscalationOnFallback:
      current.allowPrivacyEscalationOnFallback &&
      next.allowPrivacyEscalationOnFallback,
    maximumEstimatedCostMinor:
      current.maximumEstimatedCostMinor === null
        ? next.maximumEstimatedCostMinor
        : next.maximumEstimatedCostMinor === null
          ? current.maximumEstimatedCostMinor
          : Math.min(
              current.maximumEstimatedCostMinor,
              next.maximumEstimatedCostMinor,
            ),
    preferredLatencyClass: next.preferredLatencyClass,
    requireUserCredential:
      current.requireUserCredential || next.requireUserCredential,
    allowManagedCredential:
      current.allowManagedCredential && next.allowManagedCredential,
    requireHealthy: current.requireHealthy || next.requireHealthy,
  });
}

export class CapabilityPolicyResolver {
  resolve(input: {
    context: CapabilityPolicyResolutionContext;
    capability: CapabilityKind;
    purpose: string;
    policies: readonly CapabilityPolicy[];
    systemConstraints: CapabilityPolicyConstraints;
    systemPolicyEpoch?: `sha256:${string}`;
    operationOverride?: CapabilityOperationPolicyOverride;
  }): ResolvedCapabilityPolicySnapshot {
    const capability = capabilityKindSchema.parse(input.capability);
    const purpose = capabilityPurposeSchema.parse(input.purpose);
    const applicable = input.policies
      .filter(
        (policy) =>
          policy.ownerId === input.context.ownerId &&
          policy.capability === capability &&
          purposeMatches(policy.purposePattern, purpose) &&
          scopeMatches(policy, input.context),
      )
      .sort(
        (left, right) =>
          scopeRank[left.scope.kind] - scopeRank[right.scope.kind] ||
          left.id.localeCompare(right.id),
      );

    let constraints = capabilityPolicyConstraintsSchema.parse(
      input.systemConstraints,
    );
    for (const policy of applicable) {
      constraints = mergeConstraints(constraints, policy.constraints);
    }
    if (input.operationOverride?.constraints) {
      constraints = mergeConstraints(
        constraints,
        capabilityPolicyConstraintsSchema.parse({
          ...constraints,
          ...input.operationOverride.constraints,
        }),
      );
    }

    const selection = [...applicable]
      .reverse()
      .find((policy) => policy.mode !== "automatic");
    const disabled = applicable.some((policy) => policy.mode === "disabled");
    const override = input.operationOverride;
    const mode = disabled
      ? "disabled"
      : override?.mode ??
        (override?.pinnedOfferingId ? "pinned" : selection?.mode ?? "automatic");
    const primaryOfferingId = override?.pinnedOfferingId
      ? override.pinnedOfferingId
      : selection?.primaryOfferingId ?? null;
    const fallbackOfferingIds =
      mode === "disabled" || mode === "pinned"
        ? []
        : selection?.fallbackOfferingIds ?? [];
    const payload = {
      version: 1 as const,
      ownerId: input.context.ownerId,
      capability,
      purpose,
      mode,
      primaryOfferingId: mode === "disabled" ? null : primaryOfferingId,
      fallbackOfferingIds,
      constraints,
      systemPolicyEpoch:
        input.systemPolicyEpoch ?? capabilityDigest(input.systemConstraints),
      appliedPolicies: applicable.map((policy) => ({
        id: policy.id,
        revision: policy.revision,
        scopeKind: policy.scope.kind,
      })),
    };
    return { ...payload, digest: capabilityDigest(payload) };
  }
}
