import { describe, expect, test } from "bun:test";
import {
  browserRenderWorkerInputSchema,
  generatedArtifactKindSchema,
  generatedArtifactManifestV1Schema,
  ingestionReasonCodeSchema,
  videoTimelineV1Schema,
} from "./media";

const digest = "a".repeat(64);

describe("advanced media contracts", () => {
  test("keeps stable ingestion reasons and strict structured browser input", () => {
    expect(ingestionReasonCodeSchema.parse("dynamic_required")).toBe(
      "dynamic_required",
    );
    expect(() => ingestionReasonCodeSchema.parse("playwright_crashed")).toThrow();
    expect(() =>
      browserRenderWorkerInputSchema.parse({
        schemaVersion: 1,
        url: "https://school.example/course",
        wait: { kind: "dom-settled", maxMs: 1_000 },
        maxNavigations: 4,
        maxRequests: 50,
        maxResponseBytes: 1_000_000,
        capture: ["readable-html"],
        executable: "sh -c anything",
      }),
    ).toThrow();
  });

  test("represents historical artifacts without inventing a renderer image", () => {
    const manifest = generatedArtifactManifestV1Schema.parse({
      schemaVersion: 1,
      kind: "pdf",
      artifactId: "legacy-artifact",
      artifactRevisionId: "legacy-revision",
      revision: 1,
      parentArtifactRevisionIds: [],
      sourceVersionIds: [],
      workflow: { id: "legacy.document-artifact", version: 1 },
      modelRuns: [],
      renderer: {
        profile: "legacy.compatibility-reader",
        imageDigest: null,
        toolVersions: { reader: "1" },
        reproducibility: "best-effort",
      },
      output: {
        fileId: "file-1",
        digest,
        bytes: 42,
        mime: "application/pdf",
      },
    });
    expect(manifest.renderer.imageDigest).toBeNull();
    expect(manifest.output.digest).toBe(digest);
  });

  test("round-trips every existing and new artifact kind", () => {
    for (const kind of generatedArtifactKindSchema.options) {
      const manifest = generatedArtifactManifestV1Schema.parse({
        schemaVersion: 1,
        kind,
        artifactId: `artifact-${kind}`,
        artifactRevisionId: `revision-${kind}`,
        revision: 1,
        parentArtifactRevisionIds: [],
        sourceVersionIds: [],
        workflow: { id: "fixture.workflow", version: 1 },
        modelRuns: [],
        renderer: {
          profile: "fixture.renderer",
          imageDigest: `sha256:${digest}`,
          toolVersions: { fixture: "1" },
          reproducibility: "full",
        },
        output: {
          digest,
          bytes: 1,
          mime: "application/octet-stream",
        },
      });
      expect(manifest.kind).toBe(kind);
    }
  });

  test("requires gap-free timelines and exact revision references", () => {
    const scene = {
      id: "scene-1",
      startMs: 0,
      durationMs: 2_000,
      visual: {
        artifactRevisionId: "slides-r1",
        digest,
        pageOrSlide: 1,
      },
      captions: [{ id: "cue-1", startMs: 0, endMs: 1_000, text: "Hello" }],
      transition: "cut" as const,
      citations: [],
    };
    expect(
      videoTimelineV1Schema.parse({
        schemaVersion: 1,
        width: 1_920,
        height: 1_080,
        fps: 30,
        scenes: [scene],
      }).scenes[0]?.visual.artifactRevisionId,
    ).toBe("slides-r1");
    expect(() =>
      videoTimelineV1Schema.parse({
        schemaVersion: 1,
        width: 1_920,
        height: 1_080,
        fps: 30,
        scenes: [scene, { ...scene, id: "scene-2", startMs: 2_100 }],
      }),
    ).toThrow(/gap-free/u);
  });
});
