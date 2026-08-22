import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_TTS = "false";

describe("Mistral text-to-speech provider", () => {
  test("resolves the exact Mistral TTS credential route", async () => {
    const { runMistralTextToSpeech } = await import("./text-to-speech");
    const routes: string[] = [];
    await runMistralTextToSpeech("tts-key-owner", "Bonjour.", {
      resolveCredential: async (_ownerId, kind, provider) => {
        routes.push(`${kind}:${provider}`);
        return {
          source: "user" as const,
          key: "exact-mistral-tts-key",
          invalidationToken: "sealed-exact-mistral-tts-key",
        };
      },
      fetch: async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer exact-mistral-tts-key",
        );
        return Response.json({
          audio_data: Buffer.from([0xff, 0xfb]).toString("base64"),
        });
      },
    });
    expect(routes).toEqual(["mistral:mistral"]);
  });

  test("uses the official JSON contract and returns MP3 bytes", async () => {
    const {
      DEFAULT_MISTRAL_SPEECH_MODEL,
      MISTRAL_SPEECH_URL,
      runMistralTextToSpeech,
    } = await import("./text-to-speech");
    const audio = Uint8Array.from([0xff, 0xfb, 0x90, 0x64]);
    const requestBody: Record<string, unknown> = {};
    const result = await runMistralTextToSpeech(
      "tts-contract-user",
      "Bonjour, voici une fiche de révision.",
      {
        key: "tts-contract-secret",
        fetch: async (url, init) => {
          expect(String(url)).toBe(MISTRAL_SPEECH_URL);
          expect(init?.method).toBe("POST");
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer tts-contract-secret",
          );
          Object.assign(requestBody, JSON.parse(String(init?.body)));
          return Response.json({
            audio_data: Buffer.from(audio).toString("base64"),
          });
        },
      },
    );
    expect(requestBody).toEqual({
      input: "Bonjour, voici une fiche de révision.",
      model: DEFAULT_MISTRAL_SPEECH_MODEL,
      response_format: "mp3",
      stream: false,
    });
    expect([...result.audio]).toEqual([...audio]);
    expect(result).toMatchObject({
      mimeType: "audio/mpeg",
      model: DEFAULT_MISTRAL_SPEECH_MODEL,
      voiceId: null,
      chunkCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("tts-contract-secret");
  });

  test("chunks long narration and concatenates the returned MP3 streams", async () => {
    const { runMistralTextToSpeech } = await import("./text-to-speech");
    let calls = 0;
    const result = await runMistralTextToSpeech(
      "tts-chunk-user",
      `${"Première phrase assez longue. ".repeat(100)}${"Deuxième partie. ".repeat(100)}`,
      {
        key: "tts-chunk-secret",
        fetch: async () => {
          calls += 1;
          return Response.json({
            audio_data: Buffer.from([0xff, calls]).toString("base64"),
          });
        },
      },
    );
    expect(calls).toBeGreaterThan(1);
    expect(result.chunkCount).toBe(calls);
    expect(result.audio.byteLength).toBe(calls * 2);
    expect([...result.audio]).toEqual(
      Array.from({ length: calls }, (_, index) => [0xff, index + 1]).flat(),
    );
  });

  test("redacts credentials from provider failures", async () => {
    const { runMistralTextToSpeech } = await import("./text-to-speech");
    const secret = "tts-private-secret";
    try {
      await runMistralTextToSpeech("tts-failure-user", "Texte lisible.", {
        key: secret,
        fetch: async () =>
          Response.json(
            { message: `invalid credential ${secret}` },
            { status: 401 },
          ),
      });
      throw new Error("Expected speech generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("[redacted]");
      expect((error as Error).message).not.toContain(secret);
    }
  });

  test("rejects malformed audio data", async () => {
    const { runMistralTextToSpeech } = await import("./text-to-speech");
    await expect(
      runMistralTextToSpeech("tts-malformed-user", "Texte lisible.", {
        key: "tts-malformed-secret",
        sleep: async () => undefined,
        fetch: async () => Response.json({ audio_data: "not base64!" }),
      }),
    ).rejects.toThrow("malformed audio data");
  });
});
