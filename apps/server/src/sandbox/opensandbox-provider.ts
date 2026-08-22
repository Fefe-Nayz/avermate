import type { SandboxExecutionProfile } from "@avermate/agent-contracts";
import {
  EvidenceGatedRemoteSandboxProvider,
  type RemoteSandboxTransport,
} from "./remote-provider";
import { SandboxUnavailableError } from "./errors";

export type OpenSandboxIsolation =
  | { kind: "runc-trusted-dev"; trustedDevelopment: true; multiTenant: false }
  | { kind: "gvisor-personal"; multiTenant: false }
  | { kind: "kata-multitenant"; multiTenant: true };

export interface OpenSandboxProviderConfig {
  isolation: OpenSandboxIsolation;
  hostPolicyDigest: string;
  maxEvidenceAgeMs: number;
  profiles: readonly SandboxExecutionProfile[];
  transport?: RemoteSandboxTransport;
}

export class OpenSandboxProvider extends EvidenceGatedRemoteSandboxProvider {
  constructor(config: OpenSandboxProviderConfig) {
    if (config.isolation.kind === "runc-trusted-dev" && !config.isolation.trustedDevelopment) {
      throw new SandboxUnavailableError(
        "ISOLATION_NOT_ALLOWED",
        "runc is limited to explicitly trusted, single-user development.",
      );
    }
    super({
      providerId: "opensandbox",
      isolationClass: config.isolation.kind,
      hostPolicyDigest: config.hostPolicyDigest,
      maxEvidenceAgeMs: config.maxEvidenceAgeMs,
      profiles: config.profiles,
      transport: config.transport,
    });
  }
}
