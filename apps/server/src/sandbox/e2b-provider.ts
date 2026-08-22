import type { SandboxExecutionProfile } from "@avermate/agent-contracts";
import {
  EvidenceGatedRemoteSandboxProvider,
  type RemoteSandboxTransport,
} from "./remote-provider";

export interface E2BSandboxProviderConfig {
  hostPolicyDigest: string;
  maxEvidenceAgeMs: number;
  profiles: readonly SandboxExecutionProfile[];
  transport?: RemoteSandboxTransport;
}

/** Managed E2B adapter boundary. No SDK/API call exists without an injected transport. */
export class E2BSandboxProvider extends EvidenceGatedRemoteSandboxProvider {
  constructor(config: E2BSandboxProviderConfig) {
    super({
      providerId: "e2b",
      isolationClass: "e2b-managed",
      hostPolicyDigest: config.hostPolicyDigest,
      maxEvidenceAgeMs: config.maxEvidenceAgeMs,
      profiles: config.profiles,
      transport: config.transport,
    });
  }
}
