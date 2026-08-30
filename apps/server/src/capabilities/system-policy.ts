import type { CapabilityPolicyConstraints } from "@avermate/agent-contracts";
import { capabilityDigest } from "./values";

export const capabilitySystemConstraints: CapabilityPolicyConstraints = {
  requiredFeatures: [],
  allowedPlacements: [
    "core",
    "managed",
    "direct-byok",
    "node",
    "full-self-host",
  ],
  allowedProviders: null,
  deniedProviders: [],
  maximumDataEgress: "external-provider",
  allowPrivacyEscalationOnFallback: false,
  maximumEstimatedCostMinor: null,
  preferredLatencyClass: "normal",
  requireUserCredential: false,
  allowManagedCredential: true,
  requireHealthy: false,
};

/** Changes whenever the compiled system ceiling changes. */
export const capabilitySystemPolicyEpoch = capabilityDigest(
  capabilitySystemConstraints,
);
