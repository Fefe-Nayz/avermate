import { describe, expect, test } from "bun:test";
import type { NodeArtifactRef } from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import {
  executePairedNodeBrowserRender,
  executePairedNodeVideoAudioTranscription,
  mergeVideoTranscriptionSegments,
} from "./paired-node-media";

function digest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function artifact(
  key: string,
  bytes: Uint8Array,
  mimeType: string,
): NodeArtifactRef {
  return {
    object: { ownerId: "owner-a", namespace: "job-results", key },
    digest: digest(bytes),
    byteSize: bytes.byteLength,
    mimeType,
  };
}

function profile(kind: string, sandboxProfileId: "browser" | "video-audio") {
  return {
    kind: `${kind}@1`,
    sandboxProfileId,
    profileVersion: `${sandboxProfileId}-v1`,
    imageDigest: `sha256:${"a".repeat(64)}`,
    egressPolicyDigest: `sha256:${"b".repeat(64)}`,
  } as const;
}

function storage(calls: unknown[]) {
  return {
    id: "node-storage",
    async put(input: {
      ref: NodeArtifactRef["object"];
      body: ReadableStream<Uint8Array>;
      byteSize: number;
      mimeType: string;
      expectedDigest: `sha256:${string}`;
    }) {
      calls.push(input);
      return {
        ref: input.ref,
        digest: input.expectedDigest,
        byteSize: input.byteSize,
        mimeType: input.mimeType,
        etag: input.expectedDigest,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        replayed: false,
      };
    },
  };
}

describe("paired Node advanced media execution", () => {
  test("dispatches and adopts a browser capture through exact owner-bound artifacts", async () => {
    const outputBytes = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        finalUrl: "https://school.example/course",
        redirectChain: ["https://school.example/course"],
        title: "Cours dynamique",
        language: "fr",
        readableHtml: `<html><head><title>Cours dynamique</title></head><body><main><h1>Cours dynamique</h1><p>${"Un contenu scolaire utile. ".repeat(40)}</p></main></body></html>`,
        requestCount: 8,
        responseBytes: 4096,
        selectedImages: [],
      }),
    );
    const output = artifact("browser/result.json", outputBytes, "application/json");
    const stored: unknown[] = [];
    const dispatched: unknown[] = [];
    const removed: unknown[] = [];
    const result = await executePairedNodeBrowserRender(
      {
        ownerId: "owner-a",
        nodeId: "node-a",
        threadId: "thread-a",
        branchId: "branch-a",
        sourceVersionId: "version-a",
        canonicalUrl: "https://school.example/course",
        idempotencyKey: "request-a",
      },
      {
        resolveProfile: (async () => ({
          nodeId: "node-a",
          configRevision: `sha256:${"c".repeat(64)}`,
          profile: profile("artifact.browser-render", "browser"),
        })) as never,
        createStorage: (async () => storage(stored)) as never,
        dispatch: (async (input: unknown) => {
          dispatched.push(input);
          return { resultManifest: [output] };
        }) as never,
        read: (async () => ({ bytes: outputBytes })) as never,
        remove: (async (input: unknown) => {
          removed.push(input);
          return [];
        }) as never,
        urlPolicy: {
          validate: async (value: string | URL, use: string) => ({
            url: value.toString(),
            origin: new URL(value).origin,
            use,
          }),
        } as never,
        now: () => new Date("2026-08-22T10:00:00.000Z"),
      },
    );

    expect(result.extracted.title).toBe("Cours dynamique");
    expect(result.extracted.markdown).toContain("contenu scolaire utile");
    expect(stored).toHaveLength(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      ownerId: "owner-a",
      nodeId: "node-a",
      kind: "artifact.browser-render",
      inputRefs: [{ object: { ownerId: "owner-a" } }],
      resourceRefs: [{ ownerId: "owner-a" }],
    });
    expect(removed).toHaveLength(1);
  });

  test("transcribes ordered bounded audio segments and keeps absolute timestamps", async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const audio = artifact("audio/segment.mp3", audioBytes, "audio/mpeg");
    const outputValue = {
      schemaVersion: 2,
      worker: "video-audio-extract.v2",
      durationMs: 60_000,
      codec: "mp3",
      bitrateKbps: 48,
      sampleRate: 16_000,
      channels: 1,
      segments: [
        {
          index: 0,
          startMs: 0,
          endMs: 60_000,
          audio: {
            path: "output/audio-segment-000.mp3",
            digest: audio.digest,
            byteSize: audio.byteSize,
            mimeType: "audio/mpeg",
          },
        },
      ],
    } as const;
    const outputBytes = new TextEncoder().encode(JSON.stringify(outputValue));
    const output = artifact("audio/result.json", outputBytes, "application/json");
    const stored: unknown[] = [];
    const removed: unknown[] = [];
    const dispatches: Array<{ idempotencyKey: string; jobId: string }> = [];
    const transcriptionAttempts: Array<number | undefined> = [];
    const result = await executePairedNodeVideoAudioTranscription(
      {
        ownerId: "owner-a",
        nodeId: "node-a",
        threadId: "thread-a",
        branchId: "branch-a",
        sourceVersionId: "version-a",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "Cours vidéo",
        requestedLanguage: "fr",
        consentRevision: "video-audio-extraction.v1",
        idempotencyKey: "request-a",
        attempt: 2,
      },
      {
        resolveProfile: (async () => ({
          nodeId: "node-a",
          configRevision: `sha256:${"c".repeat(64)}`,
          profile: profile(
            "artifact.video-audio-extract",
            "video-audio",
          ),
        })) as never,
        createStorage: (async () => storage(stored)) as never,
        dispatch: (async (input: {
          idempotencyKey: string;
          jobId: string;
        }) => {
          dispatches.push(input);
          return dispatches.length === 1
            ? {
                terminal: {
                  stage: "failed" as const,
                  safeErrorCode: "TRANSIENT_EXTRACTION_FAILURE",
                },
                resultManifest: [],
              }
            : {
                terminal: { stage: "completed" as const },
                resultManifest: [audio, output],
              };
        }) as never,
        read: (async (input: { artifact: NodeArtifactRef }) => ({
          bytes:
            input.artifact.mimeType === "application/json"
              ? outputBytes
              : audioBytes,
        })) as never,
        remove: (async (input: unknown) => {
          removed.push(input);
          return [];
        }) as never,
        resolveTranscription: (async () => ({
          id: "mistral" as const,
          model: "voxtral-mini-latest",
          transcribeSegment: async (input: { attempt?: number }) => {
            transcriptionAttempts.push(input.attempt);
            return {
            text: "Introduction au théorème.",
            language: "fr",
            segments: [
              {
                startMs: 1_000,
                endMs: 8_000,
                text: "Introduction au théorème.",
              },
            ],
            };
          },
        })) as never,
        now: () => new Date("2026-08-22T10:00:00.000Z"),
      },
    );

    expect(result.source).toMatchObject({
      strategy: "extracted-audio",
      mediaId: "dQw4w9WgXcQ",
      durationMs: 60_000,
      transcriptProvider: "mistral",
      segments: [
        {
          startMs: 1_000,
          endMs: 8_000,
          text: "Introduction au théorème.",
        },
      ],
    });
    expect(result.markdown).toContain("Introduction au théorème");
    expect(stored).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect(dispatches).toHaveLength(2);
    expect(dispatches[0]?.jobId).not.toBe(dispatches[1]?.jobId);
    expect(transcriptionAttempts).toEqual([2]);
  });

  test("rejects missing extraction/transcription segment parity", () => {
    expect(() =>
      mergeVideoTranscriptionSegments(
        {
          schemaVersion: 2,
          worker: "video-audio-extract.v2",
          durationMs: 60_000,
          codec: "mp3",
          bitrateKbps: 48,
          sampleRate: 16_000,
          channels: 1,
          segments: [
            {
              index: 0,
              startMs: 0,
              endMs: 60_000,
              audio: {
                path: "output/audio-segment-000.mp3",
                digest: `sha256:${"c".repeat(64)}`,
                byteSize: 1,
                mimeType: "audio/mpeg",
              },
            },
          ],
        },
        [],
      ),
    ).toThrow("SEGMENT_COUNT_MISMATCH");
  });
});
