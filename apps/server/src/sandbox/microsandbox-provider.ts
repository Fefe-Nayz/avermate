import type { SandboxExecutionProfile } from "@avermate/agent-contracts";
import { SandboxUnavailableError } from "./errors";
import {
  EvidenceGatedRemoteSandboxProvider,
  type RemoteSandboxTransport,
} from "./remote-provider";

export interface MicrosandboxProviderConfig {
  experimentalOptIn: boolean;
  hostVirtualizationAttested: boolean;
  hostPolicyDigest: string;
  maxEvidenceAgeMs: number;
  profiles: readonly SandboxExecutionProfile[];
  transport?: RemoteSandboxTransport;
}

export class MicrosandboxProvider extends EvidenceGatedRemoteSandboxProvider {
  constructor(config: MicrosandboxProviderConfig) {
    if (!config.experimentalOptIn || !config.hostVirtualizationAttested) {
      throw new SandboxUnavailableError(
        "ISOLATION_NOT_ALLOWED",
        "Microsandbox requires explicit experimental opt-in and a host virtualization attestation.",
      );
    }
    super({
      providerId: "microsandbox",
      isolationClass: "microsandbox-experimental",
      hostPolicyDigest: config.hostPolicyDigest,
      maxEvidenceAgeMs: config.maxEvidenceAgeMs,
      profiles: config.profiles,
      transport: config.transport,
    });
  }
}
