import type {
  ArtifactWorkflowStatus,
  GeneratedArtifactKind,
  IngestionReasonCode,
} from "@avermate/agent-contracts";
import { canonicalJson, sha256 } from "../search/values";

export interface ArtifactWorkflowStagePlan {
  readonly key: string;
  readonly placement: "core" | "node" | "unavailable";
  readonly approvalRequired: boolean;
  readonly reusable: boolean;
}

const TERMINAL = new Set<ArtifactWorkflowStatus>([
  "completed",
  "failed",
  "cancelled",
  "superseded",
]);

const ALLOWED: Readonly<Record<ArtifactWorkflowStatus, readonly ArtifactWorkflowStatus[]>> = {
  planned: ["queued", "cancelled", "superseded", "failed"],
  queued: ["running", "cancelled", "superseded", "failed"],
  running: ["awaiting_approval", "completed", "failed", "cancelled", "superseded"],
  awaiting_approval: ["queued", "cancelled", "superseded", "failed"],
  completed: ["superseded"],
  failed: ["queued", "superseded"],
  cancelled: ["queued", "superseded"],
  superseded: [],
};

export function assertWorkflowTransition(
  from: ArtifactWorkflowStatus,
  to: ArtifactWorkflowStatus,
) {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Invalid artifact workflow transition: ${from} -> ${to}`);
  }
}

export function artifactWorkflowPlan(kind: GeneratedArtifactKind) {
  const stages: ArtifactWorkflowStagePlan[] = (() => {
    switch (kind) {
      case "video":
        return [
          { key: "validate-timeline", placement: "core", approvalRequired: false, reusable: true },
          { key: "render-video", placement: "node", approvalRequired: true, reusable: true },
          { key: "adopt-output", placement: "core", approvalRequired: false, reusable: true },
        ];
      case "video-timeline":
        return [
          { key: "resolve-citations", placement: "core", approvalRequired: false, reusable: true },
          { key: "publish-timeline", placement: "core", approvalRequired: false, reusable: true },
        ];
      case "thumbnail":
        return [
          { key: "compose-thumbnail", placement: "node", approvalRequired: true, reusable: true },
          { key: "adopt-output", placement: "core", approvalRequired: false, reusable: true },
        ];
      default:
        return [
          { key: "generate", placement: "node", approvalRequired: true, reusable: true },
          { key: "adopt-output", placement: "core", approvalRequired: false, reusable: true },
        ];
    }
  })();
  return Object.freeze({
    id: `artifact.${kind}.v1`,
    version: 1,
    stages: Object.freeze(stages),
  });
}

export function stageInputDigest(input: {
  workflowId: string;
  workflowVersion: number;
  stageKey: string;
  artifactKind: GeneratedArtifactKind;
  sourceVersionIds: readonly string[];
  parentArtifactRevisionIds: readonly string[];
  settings: unknown;
}) {
  return sha256(
    canonicalJson({
      ...input,
      sourceVersionIds: [...input.sourceVersionIds].sort(),
      parentArtifactRevisionIds: [...input.parentArtifactRevisionIds].sort(),
    }),
  );
}

export function retryDisposition(input: {
  status: ArtifactWorkflowStatus;
  attempt: number;
  reasonCode: IngestionReasonCode | null;
  inputDigest: string;
  previousCompletedInputDigest?: string | null;
  maxAttempts?: number;
}) {
  if (!TERMINAL.has(input.status) && input.status !== "awaiting_approval") {
    throw new Error("Only terminal or approval-blocked stages can be retried");
  }
  if (input.attempt >= (input.maxAttempts ?? 3)) {
    return Object.freeze({ retry: false as const, reason: "attempt_limit" as const });
  }
  if (input.reasonCode === "publisher_denied" || input.reasonCode === "permission_required") {
    return Object.freeze({ retry: false as const, reason: "policy_denied" as const });
  }
  if (
    input.status === "completed" &&
    input.previousCompletedInputDigest === input.inputDigest
  ) {
    return Object.freeze({ retry: false as const, reason: "reuse_completed" as const });
  }
  return Object.freeze({ retry: true as const, nextAttempt: input.attempt + 1 });
}

