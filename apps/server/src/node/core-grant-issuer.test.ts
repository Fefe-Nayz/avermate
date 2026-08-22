import { describe, expect, test } from "bun:test";
import type {
  NodeArtifactRef,
  OwnedObjectRef,
  UnsignedNodeJobV1,
} from "@avermate/agent-contracts";
import { CoreNodeGrantIssuer } from "./core-grant-issuer";

const ownerId = "owner-1";
const inputObject: OwnedObjectRef = {
  ownerId,
  namespace: "artifact-inputs",
  key: "request.json",
};
const nestedObject: OwnedObjectRef = {
  ownerId,
  namespace: "course-materials",
  key: "lesson.pdf",
};
const inputArtifact: NodeArtifactRef = {
  object: inputObject,
  digest: `sha256:${"a".repeat(64)}`,
  byteSize: 128,
  mimeType: "application/json",
};

function job(
  now: Date,
  resourceRefs?: readonly OwnedObjectRef[],
): UnsignedNodeJobV1 {
  return {
    id: "job-1",
    principalRef: {
      userId: ownerId,
      nodeId: "node-1",
      actorKind: "system",
    },
    kind: "artifact.browser-render",
    capabilityVersion: 1,
    inputRefs: [inputArtifact],
    ...(resourceRefs ? { resourceRefs: [...resourceRefs] } : {}),
    policyRef: `sha256:${"b".repeat(64)}`,
    limits: {
      cpuMillis: 10_000,
      memoryBytes: 256 * 1024 * 1024,
      inputBytes: 128,
      outputBytes: 1_024,
      deadline: new Date(now.getTime() + 60_000).toISOString(),
    },
    idempotencyKey: "job-1-attempt-1",
  };
}

describe("CoreNodeGrantIssuer", () => {
  const issuer = new CoreNodeGrantIssuer("a".repeat(32));
  const now = new Date("2026-08-22T10:00:00.000Z");

  test("signs the complete explicit resource authority", () => {
    const issued = issuer.issueJob(job(now, [inputObject, nestedObject]), {
      now,
    });

    expect(issued.resourceRefs).toEqual([inputObject, nestedObject]);
    expect(issued.grant.claims.resources).toEqual([inputObject, nestedObject]);
  });

  test("keeps input-only authority for legacy envelopes", () => {
    const issued = issuer.issueJob(job(now), { now });

    expect(issued.resourceRefs).toBeUndefined();
    expect(issued.grant.claims.resources).toEqual([inputObject]);
  });
});
