import { describe, expect, test } from "bun:test";
import {
  historicalBranchChoiceSchema,
  historicalBranchPreviewSchema,
} from "./assistant";

describe("historical branch contracts", () => {
  test("requires an explicit mode and forbids workspace fields on conversation-only", () => {
    expect(() =>
      historicalBranchChoiceSchema.parse({ sourceBranchId: "branch-source" }),
    ).toThrow();
    expect(() =>
      historicalBranchChoiceSchema.parse({
        mode: "conversation-only",
        sourceBranchId: "branch-source",
        snapshotId: "snapshot-hidden-fallback",
      }),
    ).toThrow();
    expect(
      historicalBranchChoiceSchema.parse({
        mode: "conversation-only",
        sourceBranchId: "branch-source",
      }),
    ).toEqual({
      mode: "conversation-only",
      sourceBranchId: "branch-source",
    });
  });

  test("binds workspace copy confirmation to one committed manifest digest", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(() =>
      historicalBranchChoiceSchema.parse({
        mode: "workspace-copy",
        sourceBranchId: "branch-source",
        snapshotId: "snapshot-committed",
      }),
    ).toThrow();
    expect(
      historicalBranchChoiceSchema.parse({
        mode: "workspace-copy",
        sourceBranchId: "branch-source",
        snapshotId: "snapshot-committed",
        expectedPortableManifestDigest: digest,
      }),
    ).toMatchObject({
      mode: "workspace-copy",
      snapshotId: "snapshot-committed",
      expectedPortableManifestDigest: digest,
    });
  });

  test("represents incompatibility explicitly instead of substituting another snapshot", () => {
    const digest = `sha256:${"b".repeat(64)}`;
    const preview = historicalBranchPreviewSchema.parse({
      operation: "retry",
      threadId: "thread-a",
      sourceBranchId: "branch-source",
      messageId: "message-old",
      conversationOnly: { available: true },
      workspaceCopy: {
        available: false,
        reason: "snapshot-incompatible",
        message: "The exact image is unavailable.",
        snapshot: {
          id: "snapshot-latest",
          conversationCheckpointRef: "checkpoint-a",
          sequence: 3,
          executionProfileId: "latex",
          executionProfileVersion: "latex-v1",
          imageDigest: digest,
          provider: "mock",
          portableManifestDigest: digest,
          byteSize: 12,
          fileCount: 1,
          committedAt: "2026-08-22T10:00:00.000Z",
        },
      },
    });
    expect(preview.workspaceCopy).toMatchObject({
      available: false,
      reason: "snapshot-incompatible",
      snapshot: { id: "snapshot-latest" },
    });
  });
});
