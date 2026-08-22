import type { GeneratedArtifactKind } from "@avermate/agent-contracts";

export type ArtifactWorkflowExternalStageKey =
  | "generate"
  | "render-video"
  | "compose-thumbnail"
  | "adopt-output";

export type ArtifactWorkflowStageExecutionInput = Readonly<{
  ownerId: string;
  runId: string;
  artifactId: string;
  kind: GeneratedArtifactKind;
  workflowId: string;
  workflowVersion: number;
  inputDigest: string;
  sourceVersionIds: readonly string[];
  parentArtifactRevisionIds: readonly string[];
  settings: Readonly<Record<string, unknown>>;
  stageId: string;
  stageKey: ArtifactWorkflowExternalStageKey;
  stagePosition: number;
  stageAttempt: number;
  stageInputDigest: string;
  executionDeadline: string;
}>;

export interface ArtifactWorkflowStageExecutor {
  execute(
    input: ArtifactWorkflowStageExecutionInput,
    signal?: AbortSignal,
  ): Promise<string | null>;
}

/** A policy/input failure that must not be retried as an infrastructure fault. */
export class ArtifactWorkflowStageInputError extends Error {
  constructor(
    readonly safeMessage: string,
    options?: ErrorOptions,
  ) {
    super(safeMessage, options);
    this.name = "ArtifactWorkflowStageInputError";
  }
}
