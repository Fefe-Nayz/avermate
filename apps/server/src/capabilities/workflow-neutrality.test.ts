import { describe, expect, test } from "bun:test";
import { resolveOcrProvider } from "../lib/ocr";
import { resolveTranscriptionProvider } from "../lib/transcription";
import { CapabilityRuntime } from "./runtime";
import type { CapabilityArtifactIo } from "./artifact-io";
import type { CapabilityRegistryInvoker } from "./registry-invoker";

const runtime = new CapabilityRuntime({ modeFor: () => "registry" });
const artifacts: CapabilityArtifactIo = {
  async read() {
    throw new Error("not used");
  },
  async write(input) {
    return {
      object: { ownerId: input.ownerId, namespace: "files", key: "source" },
      digest: `sha256:${"a".repeat(64)}`,
      byteSize: input.bytes.byteLength,
      mimeType: input.mimeType,
    };
  },
};

describe("provider-neutral media workflow facades", () => {
  for (const capability of ["speech.transcribe", "document.ocr"] as const) {
    test(`${capability} accepts a new plugin without a provider ID branch`, async () => {
      let calls = 0;
      const registry: Pick<
        CapabilityRegistryInvoker,
        "prepare" | "resolve" | "invoke"
      > = {
        async resolve() {
          throw new Error("shadow-only path");
        },
        async prepare(input) {
          expect(input.projectId).toBe("owned-project");
          return {
            offering: {
              capability,
              provider: "new-provider-never-listed",
              modelId: "fixture",
              modelRevision: "v1",
            },
          } as never;
        },
        async invoke(input) {
          calls += 1;
          expect(input.route?.provider).toBe("new-provider-never-listed");
          expect(input.projectId).toBe("owned-project");
          return (
            capability === "speech.transcribe"
              ? {
                  text: "Bonjour",
                  language: "fr",
                  segments: [{ startMs: 0, endMs: 100, text: "Bonjour" }],
                }
              : {
                  pageCount: 1,
                  pages: [{ page: 1, markdown: "Bonjour" }],
                  providerMetadata: null,
                }
          ) as never;
        },
      };
      const dependencies = {
        runtime,
        registry,
        artifacts,
        selectNode: async () => {
          throw new Error("legacy must not run");
        },
      };
      const options = { projectId: "owned-project" };
      if (capability === "speech.transcribe") {
        const provider = await resolveTranscriptionProvider(
          "owner",
          options,
          dependencies,
        );
        expect(provider.id).toBe("capability-registry");
        const result = await provider.transcribeSegment({
          blob: new Blob(["audio"]),
          mimeType: "audio/webm",
        });
        expect(result.text).toBe("Bonjour");
      } else {
        const provider = await resolveOcrProvider(
          "owner",
          options,
          dependencies,
        );
        expect(provider.id).toBe("capability-registry");
        const result = await provider.run({
          blob: new Blob(["pdf"], { type: "application/pdf" }),
          name: "fixture.pdf",
        });
        expect(result.markdown).toBe("Bonjour");
      }
      expect(calls).toBe(1);
    });
  }
});
