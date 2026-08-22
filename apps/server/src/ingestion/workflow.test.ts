import { describe, expect, test } from "bun:test";
import {
  artifactWorkflowPlan,
  assertWorkflowTransition,
  retryDisposition,
  stageInputDigest,
} from "./workflow";

describe("artifact workflow state machine", () => {
  test("keeps approval and rendering as explicit durable stages", () => {
    const plan = artifactWorkflowPlan("video");
    expect(plan.stages.map((stage) => stage.key)).toEqual([
      "validate-timeline",
      "render-video",
      "adopt-output",
    ]);
    expect(plan.stages[1]).toMatchObject({
      placement: "node",
      approvalRequired: true,
    });
  });

  test("rejects impossible transitions and bounds retries", () => {
    expect(() => assertWorkflowTransition("completed", "running")).toThrow();
    expect(
      retryDisposition({
        status: "failed",
        attempt: 1,
        reasonCode: "internal_failure",
        inputDigest: "a".repeat(64),
      }),
    ).toEqual({ retry: true, nextAttempt: 2 });
    expect(
      retryDisposition({
        status: "failed",
        attempt: 3,
        reasonCode: "internal_failure",
        inputDigest: "a".repeat(64),
      }),
    ).toEqual({ retry: false, reason: "attempt_limit" });
  });

  test("reuses only an exact completed stage digest", () => {
    const input = {
      workflowId: "artifact.video.v1",
      workflowVersion: 1,
      stageKey: "render-video",
      artifactKind: "video" as const,
      sourceVersionIds: ["source-b", "source-a"],
      parentArtifactRevisionIds: ["revision-a"],
      settings: { fps: 30 },
    };
    const first = stageInputDigest(input);
    const reordered = stageInputDigest({
      ...input,
      sourceVersionIds: ["source-a", "source-b"],
    });
    expect(reordered).toBe(first);
    expect(
      retryDisposition({
        status: "completed",
        attempt: 1,
        reasonCode: null,
        inputDigest: first,
        previousCompletedInputDigest: first,
      }),
    ).toEqual({ retry: false, reason: "reuse_completed" });
  });
});

