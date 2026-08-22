import type {
  CapabilityEntitlement,
  ManagedCapability,
  UsageUnit,
} from "@avermate/agent-contracts";

export const MANAGED_CAPABILITIES: readonly ManagedCapability[] = [
  "storage.bytes",
  "ocr.pages",
  "transcription.seconds",
  "model.inputTokens",
  "model.outputTokens",
  "model.cachedInputTokens",
  "embedding.units",
  "tts.characters",
  "sandbox.cpuMillis",
  "sandbox.memoryByteSeconds",
  "sandbox.egressBytes",
  "video.outputSeconds",
] as const;

export const CAPABILITY_UNITS: Record<ManagedCapability, UsageUnit> = {
  "storage.bytes": "bytes",
  "ocr.pages": "pages",
  "transcription.seconds": "seconds",
  "model.inputTokens": "tokens",
  "model.outputTokens": "tokens",
  "model.cachedInputTokens": "tokens",
  "embedding.units": "units",
  "tts.characters": "characters",
  "sandbox.cpuMillis": "cpu-milliseconds",
  "sandbox.memoryByteSeconds": "memory-byte-seconds",
  "sandbox.egressBytes": "egress-bytes",
  "video.outputSeconds": "output-seconds",
};

export function capabilityMap(
  factory: (
    capability: ManagedCapability,
    unit: UsageUnit,
  ) => CapabilityEntitlement,
): Record<ManagedCapability, CapabilityEntitlement> {
  return Object.fromEntries(
    MANAGED_CAPABILITIES.map((capability) => [
      capability,
      factory(capability, CAPABILITY_UNITS[capability]),
    ]),
  ) as Record<ManagedCapability, CapabilityEntitlement>;
}

export const FREE_MANAGED_ENTITLEMENTS = capabilityMap((_capability, unit) => ({
  enabled: false,
  hardLimit: "0",
  softLimit: "0",
  unit,
  concurrency: 0,
  retentionDays: 30,
}));

export const SELF_HOST_ENTITLEMENTS = capabilityMap((_capability, unit) => ({
  enabled: true,
  unit,
}));
