import { describe, expect, test } from "bun:test";
import {
  AiSdkElevenLabsSpeechSynthesisAdapter,
  BoundedSpeechSynthesisProtocolAdapter,
} from "./speech-synthesis";
import {
  AiSdkDeepgramTranscriptionAdapter,
  BoundedTranscriptionProtocolAdapter,
} from "./transcription";

describe("capability-specific media provider adapters", () => {
  test("uses the official AI SDK ElevenLabs speech adapter exactly once", async () => {
    let calls = 0;
    const adapter = new AiSdkElevenLabsSpeechSynthesisAdapter({
      fetch: async (url, init) => {
        calls += 1;
        expect(String(url)).toContain(
          "/v1/text-to-speech/voice-fr?output_format=mp3_44100_128",
        );
        expect(new Headers(init?.headers).get("xi-api-key")).toBe(
          "elevenlabs-secret",
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          text: "Bonjour",
          model_id: "eleven_multilingual_v2",
        });
        return new Response(Uint8Array.from([0xff, 0xfb, 0x90]), {
          headers: {
            "content-type": "audio/mpeg",
            "request-id": "eleven-request-1",
          },
        });
      },
    });
    const result = await adapter.synthesizeChunk({
      text: "Bonjour",
      model: "eleven_multilingual_v2",
      voiceId: "voice-fr",
      credential: "elevenlabs-secret",
      signal: new AbortController().signal,
    });
    expect(calls).toBe(1);
    expect([...result.audio]).toEqual([0xff, 0xfb, 0x90]);
    expect(result).toMatchObject({
      mimeType: "audio/mpeg",
      providerRequestId: "eleven-request-1",
    });
  });

  test("disables AI SDK fallback/retries for ElevenLabs", async () => {
    let calls = 0;
    const adapter = new AiSdkElevenLabsSpeechSynthesisAdapter({
      fetch: async () => {
        calls += 1;
        return Response.json({ detail: "busy" }, { status: 503 });
      },
    });
    await expect(
      adapter.synthesizeChunk({
        text: "Bonjour",
        model: "eleven_multilingual_v2",
        voiceId: "voice-fr",
        credential: "never-log-me",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("ElevenLabs speech returned 503");
    expect(calls).toBe(1);
  });

  test("uses the official AI SDK Deepgram transcription with closed options", async () => {
    let calls = 0;
    const adapter = new AiSdkDeepgramTranscriptionAdapter({
      fetch: async (url, init) => {
        calls += 1;
        const endpoint = new URL(String(url));
        expect(endpoint.origin).toBe("https://api.deepgram.com");
        expect(endpoint.pathname).toBe("/v1/listen");
        expect(Object.fromEntries(endpoint.searchParams)).toEqual({
          model: "nova-3",
          detect_language: "false",
          diarize: "false",
          language: "fr",
          punctuate: "true",
          smart_format: "true",
        });
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Token deepgram-secret",
        );
        return Response.json(
          {
            metadata: { duration: 1.25 },
            results: {
              channels: [
                {
                  detected_language: "fr",
                  alternatives: [
                    {
                      transcript: "Bonjour le monde",
                      words: [
                        { word: "Bonjour", start: 0, end: 0.5 },
                        { word: "monde", start: 0.5, end: 1.25 },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          { headers: { "x-request-id": "deepgram-request-1" } },
        );
      },
    });
    const result = await adapter.transcribeSegment({
      blob: new Blob(["audio"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      language: "fr",
      model: "nova-3",
      credential: "deepgram-secret",
      signal: new AbortController().signal,
    });
    expect(calls).toBe(1);
    expect(result).toEqual({
      text: "Bonjour le monde",
      language: "fr",
      segments: [
        { text: "Bonjour", startMs: 0, endMs: 500 },
        { text: "monde", startMs: 500, endMs: 1_250 },
      ],
    });
  });

  test("keeps the reviewed sidecar speech protocol bounded and unary", async () => {
    const adapter = new BoundedSpeechSynthesisProtocolAdapter({
      endpoint: "http://node-sidecar.internal/speech",
      providerId: "node-sidecar",
      fetch: async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          schemaVersion: 1,
          text: "Cours",
          model: "local-voice-v1",
          voice: { mode: "exact", voiceId: "neutral-fr" },
          output: { container: "mp3" },
        });
        return new Response(Uint8Array.from([1, 2, 3]), {
          headers: { "content-type": "audio/mpeg" },
        });
      },
    });
    const result = await adapter.synthesizeChunk({
      text: "Cours",
      model: "local-voice-v1",
      voiceId: "neutral-fr",
      credential: null,
      signal: new AbortController().signal,
    });
    expect([...result.audio]).toEqual([1, 2, 3]);
  });

  test("normalizes the reviewed sidecar transcription protocol", async () => {
    const adapter = new BoundedTranscriptionProtocolAdapter({
      endpoint: "http://node-sidecar.internal/transcribe",
      providerId: "node-sidecar",
      fetch: async (_url, init) => {
        const form = init?.body as FormData;
        expect(form.get("schemaVersion")).toBe("1");
        expect(form.get("timestamps")).toBe("segment");
        expect(form.get("language")).toBe("fr");
        return Response.json({
          text: "Cours local",
          language: "fr",
          segments: [{ start: 0, end: 750, text: "Cours local" }],
        });
      },
    });
    expect(
      await adapter.transcribeSegment({
        blob: new Blob(["audio"]),
        mimeType: "audio/ogg",
        language: "fr",
        model: "whisper-local",
        credential: null,
        signal: new AbortController().signal,
      }),
    ).toEqual({
      text: "Cours local",
      language: "fr",
      segments: [{ startMs: 0, endMs: 750, text: "Cours local" }],
    });
  });
});
