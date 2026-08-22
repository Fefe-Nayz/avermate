import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sharedTestDatabase = join(
  tmpdir(),
  `avermate-recordings-${process.pid}.db`,
).replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${sharedTestDatabase}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_TRANSCRIPTION = "false";

describe("Mistral transcription provider", () => {
  test("resolves only the exact Mistral credential and never sends an OpenAI key", async () => {
    const { runMistralTranscription } = await import("./transcription");
    const routes: string[] = [];
    let fetchCalls = 0;
    const result = await runMistralTranscription(
      "transcription-key-owner",
      { blob: new Blob(["audio"]), mimeType: "audio/webm" },
      {
        resolveCredential: async (_ownerId, kind, provider) => {
          routes.push(`${kind}:${provider}`);
          return {
            source: "user" as const,
            key: "mistral-transcription-secret",
            invalidationToken: "sealed-mistral-transcription-secret",
          };
        },
        fetch: async (_url, init) => {
          fetchCalls += 1;
          const authorization = new Headers(init?.headers).get("authorization");
          expect(authorization).toBe("Bearer mistral-transcription-secret");
          expect(authorization).not.toContain("openai-secret-must-not-leak");
          return Response.json({ text: "Bonjour", segments: [] });
        },
      },
    );
    expect(result.text).toBe("Bonjour");
    expect(routes).toEqual(["transcription:mistral"]);
    expect(fetchCalls).toBe(1);

    let leakedFetch = false;
    await expect(
      runMistralTranscription(
        "openai-only-owner",
        { blob: new Blob(["audio"]), mimeType: "audio/webm" },
        {
          resolveCredential: async (_ownerId, kind, provider) => {
            expect(`${kind}:${provider}`).toBe("transcription:mistral");
            throw new Error(
              "SERVICE_KEY_PROVIDER_ROUTE_UNSUPPORTED:transcription:openai",
            );
          },
          fetch: async () => {
            leakedFetch = true;
            throw new Error("OpenAI credential was sent to Mistral");
          },
        },
      ),
    ).rejects.toThrow("SERVICE_KEY_PROVIDER_ROUTE_UNSUPPORTED");
    expect(leakedFetch).toBe(false);
  });

  test("routes selected Node STT with exact revision and never falls back", async () => {
    const { resolveTranscriptionProvider } = await import("./transcription");
    let nodeCalls = 0;
    let mistralCalls = 0;
    const provider = await resolveTranscriptionProvider(
      "stt-node-owner",
      {},
      {
        selectNode: async () => ({
          selected: true,
          nodeId: "node-stt",
          configRevision: `sha256:${"a".repeat(64)}`,
          profile: {} as never,
          modelId: "selfhost/whisper-large-v3-turbo-q5_0",
          modelRevision: "whisper-large-v3-turbo-q5_0-2026-08",
        }),
        runNode: async () => {
          nodeCalls += 1;
          return {
            text: "Local transcript",
            language: "fr",
            segments: [{ startMs: 0, endMs: 1_000, text: "Local" }],
          };
        },
        runMistral: async () => {
          mistralCalls += 1;
          throw new Error("cloud fallback must not run");
        },
      },
    );
    expect(provider.id).toBe("node-local");
    expect(provider.model).toBe(
      "selfhost/whisper-large-v3-turbo-q5_0@whisper-large-v3-turbo-q5_0-2026-08",
    );
    const result = await provider.transcribeSegment({
      blob: new Blob(["audio"]),
      mimeType: "audio/webm",
    });
    expect(result.segments[0]).toEqual({
      startMs: 0,
      endMs: 1_000,
      text: "Local",
    });
    expect(nodeCalls).toBe(1);
    expect(mistralCalls).toBe(0);

    await expect(
      resolveTranscriptionProvider(
        "stt-node-owner",
        {},
        {
          selectNode: async () => {
            throw new Error("NODE_TRANSCRIPTION_MODEL_NOT_ATTESTED");
          },
          runMistral: async () => {
            mistralCalls += 1;
            throw new Error("cloud fallback must not run");
          },
        },
      ),
    ).rejects.toThrow("NODE_TRANSCRIPTION_MODEL_NOT_ATTESTED");
    expect(mistralCalls).toBe(0);
  });

  test("sends the verified multipart contract and converts seconds to milliseconds", async () => {
    const {
      MISTRAL_TRANSCRIPTION_MODEL,
      MISTRAL_TRANSCRIPTION_URL,
      runMistralTranscription,
    } = await import("./transcription");
    let calls = 0;
    const result = await runMistralTranscription(
      "transcription-contract-user",
      {
        blob: new Blob(["audio"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        language: "fr",
      },
      {
        key: "contract-secret-key",
        fetch: async (url, init) => {
          calls += 1;
          expect(String(url)).toBe(MISTRAL_TRANSCRIPTION_URL);
          expect(init?.method).toBe("POST");
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer contract-secret-key",
          );
          const form = init?.body as FormData;
          expect(form.get("model")).toBe(MISTRAL_TRANSCRIPTION_MODEL);
          expect(form.getAll("timestamp_granularities")).toEqual(["segment"]);
          expect(form.has("language")).toBe(false);
          const file = form.get("file");
          expect(file).toBeInstanceOf(File);
          expect((file as File).name).toBe("segment.webm");
          expect((file as File).type).toBe("audio/webm");
          return Response.json({
            text: "Bonjour le monde",
            language: "fr",
            segments: [
              { start: 0, end: 1.234, text: "Bonjour" },
              { start: 1.234, end: 2.5, text: "le monde" },
            ],
          });
        },
      },
    );
    expect(calls).toBe(1);
    expect(result).toEqual({
      text: "Bonjour le monde",
      language: "fr",
      segments: [
        { startMs: 0, endMs: 1_234, text: "Bonjour" },
        { startMs: 1_234, endMs: 2_500, text: "le monde" },
      ],
    });
  });

  test("retries retryable responses exactly six times and redacts credentials", async () => {
    const { runMistralTranscription } = await import("./transcription");
    const sleeps: number[] = [];
    let calls = 0;
    let thrown: unknown;
    try {
      await runMistralTranscription(
        "transcription-retry-user",
        {
          blob: new Blob(["audio"]),
          mimeType: "audio/mp4",
        },
        {
          key: "never-expose-this-key",
          fetch: async () => {
            calls += 1;
            return Response.json(
              { message: "temporary never-expose-this-key outage" },
              { status: 503 },
            );
          },
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        },
      );
    } catch (error) {
      thrown = error;
    }
    expect(calls).toBe(6);
    expect(sleeps).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("[redacted]");
    expect((thrown as Error).message).not.toContain("never-expose-this-key");
  });

  test("does not retry a terminal provider rejection", async () => {
    const { runMistralTranscription } = await import("./transcription");
    let calls = 0;
    await expect(
      runMistralTranscription(
        "transcription-terminal-user",
        { blob: new Blob(["bad"]), mimeType: "audio/ogg" },
        {
          key: "terminal-key",
          fetch: async () => {
            calls += 1;
            return Response.json(
              { message: "unsupported audio" },
              { status: 400 },
            );
          },
          sleep: async () => {
            throw new Error("A terminal response must not sleep");
          },
        },
      ),
    ).rejects.toThrow("unsupported audio");
    expect(calls).toBe(1);
  });

  test("bounds every suspended provider attempt and exhausts exactly six retries", async () => {
    const { runMistralTranscription } = await import("./transcription");
    let calls = 0;
    await expect(
      runMistralTranscription(
        "transcription-timeout-user",
        { blob: new Blob(["audio"]), mimeType: "audio/webm" },
        {
          key: "timeout-key",
          attemptTimeoutMs: 5,
          sleep: async () => undefined,
          fetch: async (_url, init) => {
            calls += 1;
            return new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal;
              if (!signal) throw new Error("Expected the attempt abort signal");
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
            });
          },
        },
      ),
    ).rejects.toThrow("attempt timed out");
    expect(calls).toBe(6);
  });

  test("applies the attempt deadline while reading a suspended provider body", async () => {
    const { runMistralTranscription } = await import("./transcription");
    let calls = 0;
    await expect(
      runMistralTranscription(
        "transcription-body-timeout-user",
        { blob: new Blob(["audio"]), mimeType: "audio/webm" },
        {
          key: "body-timeout-key",
          attemptTimeoutMs: 5,
          sleep: async () => undefined,
          fetch: async () => {
            calls += 1;
            return new Response(
              new ReadableStream<Uint8Array>({
                pull: () => new Promise<void>(() => undefined),
              }),
              { status: 200 },
            );
          },
        },
      ),
    ).rejects.toThrow("attempt timed out");
    expect(calls).toBe(6);
  });

  test("rejects oversized input before any provider request", async () => {
    const { runMistralTranscription } = await import("./transcription");
    let called = false;
    await expect(
      runMistralTranscription(
        "transcription-limit-user",
        { blob: new Blob(["12345"]), mimeType: "audio/mp4" },
        {
          key: "limit-key",
          maxBytes: 4,
          fetch: async () => {
            called = true;
            return Response.json({});
          },
        },
      ),
    ).rejects.toThrow("32 MiB");
    expect(called).toBe(false);
  });

  test("stops reading an oversized provider response", async () => {
    const { runMistralTranscription } = await import("./transcription");
    let emitted = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    await expect(
      runMistralTranscription(
        "transcription-response-limit-user",
        { blob: new Blob(["audio"]), mimeType: "audio/mp4" },
        {
          key: "response-limit-key",
          fetch: async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  if (emitted >= 9) {
                    controller.close();
                    return;
                  }
                  emitted += 1;
                  controller.enqueue(chunk);
                },
              }),
              { status: 200 },
            ),
        },
      ),
    ).rejects.toThrow("configured limit");
    expect(emitted).toBe(9);
  });

  test("honors the runtime disable hatch", async () => {
    const { runMistralTranscription } = await import("./transcription");
    process.env.DISABLE_TRANSCRIPTION = "true";
    try {
      await expect(
        runMistralTranscription(
          "transcription-disabled-user",
          { blob: new Blob(["audio"]), mimeType: "audio/mp4" },
          { key: "disabled-key" },
        ),
      ).rejects.toThrow("disabled");
    } finally {
      process.env.DISABLE_TRANSCRIPTION = "false";
    }
  });
});
