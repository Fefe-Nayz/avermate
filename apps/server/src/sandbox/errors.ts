import type { SandboxUnavailableReason } from "@avermate/agent-contracts";

export class SandboxUnavailableError extends Error {
  readonly name = "SandboxUnavailableError";

  constructor(
    readonly reason: SandboxUnavailableReason,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class SandboxPolicyError extends Error {
  readonly name = "SandboxPolicyError";

  constructor(
    readonly policy: "resource" | "egress" | "secret" | "filesystem" | "process",
    message: string,
  ) {
    super(message);
  }
}

export class SandboxArtifactError extends Error {
  readonly name = "SandboxArtifactError";

  constructor(
    readonly code:
      | "INVALID_MANIFEST"
      | "UNSAFE_PATH"
      | "UNSAFE_NODE"
      | "LIMIT_EXCEEDED"
      | "DIGEST_MISMATCH"
      | "CONTENT_MISMATCH"
      | "STORE_FAILED",
    message: string,
  ) {
    super(message);
  }
}
