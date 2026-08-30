import { describe, expect, test } from "bun:test";
import type {
  CapabilityAdapter,
  CapabilityArtifactRef,
  CapabilityAttemptContext,
  ModelGatewayEvent,
  ProviderConnectionPublicSnapshot,
  StreamingCapabilityAdapter,
  UnaryCapabilityAdapter,
} from "@avermate/agent-contracts";
import type { CapabilityArtifactIo } from "../artifact-io";
import { createWorkflowProviderPluginFactories } from "./plugins";
import { staticProviderPluginRegistry } from "../plugin-registry";

const digest = `sha256:${"a".repeat(64)}` as const;

function connection(pluginId: string): ProviderConnectionPublicSnapshot {
  return {
    schemaVersion: 1,
    id: `connection-${pluginId}`,
    ownerKind: "user",
    ownerId: "owner-1",
    pluginId,
    pluginVersion: "1.0.0",
    displayName: pluginId,
    placement: { kind: "direct-byok", origin: "https://api.example.test" },
    configVersion: 1,
    config: {},
    configDigest: digest,
    status: "ready",
    revision: 3,
    lastValidatedAt: "2026-08-28T10:00:00.000Z",
    createdAt: "2026-08-28T09:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    deletedAt: null,
  };
}

function artifactIo(
  writes: Uint8Array[],
  readBytes?: Uint8Array,
): CapabilityArtifactIo {
  return {
    async read() {
      if (!readBytes) throw new Error("not used");
      return readBytes;
    },
    async write(input) {
      writes.push(input.bytes);
      return {
        object: {
          ownerId: input.ownerId,
          namespace: "files",
          key: `file-${writes.length}`,
        },
        digest,
        byteSize: input.bytes.byteLength,
        mimeType: input.mimeType,
      } satisfies CapabilityArtifactRef;
    },
  };
}

function attemptContext(
  offering: CapabilityAttemptContext["offering"],
  authorizations: { count: number },
): CapabilityAttemptContext {
  return {
    ownerId: "owner-1",
    operationId: "operation-1",
    attemptId: "attempt-1",
    attemptNumber: 1,
    purpose: "media.podcast-narration",
    offering,
    routePlanDigest: digest,
    deadline: new Date("2026-08-28T11:00:00.000Z"),
    signal: new AbortController().signal,
    async authorize() {
      authorizations.count += 1;
    },
    async credential(slot) {
      expect(slot).toBe("apiKey");
      return {
        connectionId: offering.connectionId,
        slot,
        version: 2,
        attemptId: "attempt-1",
        secret: "provider-secret",
        expiresAt: new Date("2026-08-28T11:00:00.000Z"),
      };
    },
    async emit() {},
  };
}

function unary(value: CapabilityAdapter) {
  if (!("invoke" in value)) throw new Error("expected unary adapter");
  return value as UnaryCapabilityAdapter<"speech.synthesize">;
}

describe("workflow provider plugin factories", () => {
  test("every advertised capability has a discoverable, instantiable adapter", async () => {
    for (const [pluginId, factory] of Object.entries(
      createWorkflowProviderPluginFactories({ artifacts: artifactIo([]) }),
    )) {
      const plugin = factory!();
      const current: ProviderConnectionPublicSnapshot = {
        ...connection(pluginId),
        ...(pluginId === "avermate.native-document"
          ? { placement: { kind: "core" as const, instanceId: "core-test" } }
          : {}),
        config:
          pluginId === "avermate.openai-compatible"
            ? {
                origin: "https://fixture.example",
                modelId: "fixture-model",
                dimensions: 16,
              }
            : {},
      };
      expect(plugin.manifest).toEqual(
        staticProviderPluginRegistry.require(pluginId).manifest,
      );
      const context = {
        ownerId: "owner-1",
        now: new Date(),
        signal: new AbortController().signal,
        credential: async () => ({ secret: "fixture", version: 1 }),
      };
      const offerings = await plugin.discoverOfferings(context, current);
      expect(
        [...new Set(offerings.map((offering) => offering.capability))].sort(),
      ).toEqual([...plugin.manifest.capabilities].sort());
      for (const offering of offerings) {
        const adapter = await plugin.createAdapter(
          { ...context, connection: current },
          offering,
        );
        expect(adapter.kind).toBe(offering.capability);
        expect(adapter.descriptor()).toEqual(offering);
      }
    }
  });

  test("rejects an invalid API key without exposing the credential or response body", async () => {
    const secret = "secret-that-must-never-escape";
    const plugin = createWorkflowProviderPluginFactories({
      mistralValidationFetch: async (_url, init) => {
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${secret}`,
        );
        return Response.json(
          { detail: `provider echoed ${secret}` },
          {
            status: 401,
            headers: { "x-request-id": "validation-request-1" },
          },
        );
      },
    })["avermate.mistral"]!();

    const result = await plugin.validateConnection(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret, version: 7 }),
      },
      {},
    );

    expect(result).toMatchObject({
      valid: false,
      error: {
        code: "CREDENTIAL_INVALID",
        retryable: false,
        providerRequestId: "validation-request-1",
        safeDiagnostic: { httpStatus: 401 },
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("provider echoed");
  });

  test("never follows a provider validation redirect with the credential", async () => {
    let calls = 0;
    const plugin = createWorkflowProviderPluginFactories({
      elevenLabsValidationFetch: async (_url, init) => {
        calls += 1;
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("xi-api-key")).toBe(
          "provider-secret",
        );
        return new Response(null, {
          status: 302,
          headers: { location: "https://attacker.example/collect" },
        });
      },
    })["ai-sdk.elevenlabs"]!();

    const result = await plugin.validateConnection(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret: "provider-secret", version: 2 }),
      },
      {},
    );

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      valid: false,
      error: { code: "PROVIDER_UNAVAILABLE", retryable: false },
    });
  });

  test("rejects a private OpenAI-compatible validation origin before transport", async () => {
    const plugin =
      createWorkflowProviderPluginFactories()["avermate.openai-compatible"]!();

    const result = await plugin.validateConnection(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret: "provider-secret", version: 2 }),
      },
      { origin: "http://127.0.0.1", modelId: "local-model" },
    );

    expect(result).toMatchObject({
      valid: false,
      error: {
        code: "PROVIDER_UNAVAILABLE",
        providerRequestId: null,
        safeDiagnostic: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });

  test("discovers and invokes the immutable Mistral TTS offering", async () => {
    const writes: Uint8Array[] = [];
    let providerCalls = 0;
    const factory = createWorkflowProviderPluginFactories({
      artifacts: artifactIo(writes),
      mistralFetch: async (_url, init) => {
        providerCalls += 1;
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer provider-secret",
        );
        return Response.json(
          { audio_data: Buffer.from([1, 2, 3]).toString("base64") },
          { headers: { "x-request-id": "mistral-request-1" } },
        );
      },
    })["avermate.mistral"]!;
    const plugin = factory();
    const currentConnection = connection("avermate.mistral");
    const [offering] = await plugin.discoverOfferings(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret: "provider-secret", version: 2 }),
        now: new Date("2026-08-28T10:00:00.000Z"),
      },
      currentConnection,
    );
    expect(offering?.id).toStartWith("capoff_");
    expect(offering).toMatchObject({
      capability: "speech.synthesize",
      provider: "mistral",
      adapterRevision: "mistral-speech-json/1",
    });
    const adapter = unary(
      await plugin.createAdapter(
        {
          ownerId: "owner-1",
          signal: new AbortController().signal,
          credential: async () => ({ secret: "provider-secret", version: 2 }),
          connection: currentConnection,
        },
        offering!,
      ),
    );
    const authorizations = { count: 0 };
    const result = await adapter.invoke(
      attemptContext(offering!, authorizations),
      {
        schemaVersion: 1,
        text: "Bonjour le cours.",
        voice: { mode: "exact", voiceId: "default" },
        output: { container: "mp3" },
        alignment: "none",
      },
    );
    expect(providerCalls).toBe(1);
    expect(authorizations.count).toBe(2);
    expect([...writes[0]!]).toEqual([1, 2, 3]);
    expect(result.audio.object.key).toBe("file-1");
  });

  test("invokes ElevenLabs through the official SDK without SDK retry", async () => {
    const writes: Uint8Array[] = [];
    let providerCalls = 0;
    const factory = createWorkflowProviderPluginFactories({
      artifacts: artifactIo(writes),
      elevenLabsFetch: async (url, init) => {
        providerCalls += 1;
        expect(String(url)).toContain("/v1/text-to-speech/voice-fr");
        expect(new Headers(init?.headers).get("xi-api-key")).toBe(
          "provider-secret",
        );
        return new Response(Uint8Array.from([0xff, 0xfb, 0x90]), {
          headers: { "content-type": "audio/mpeg" },
        });
      },
    })["ai-sdk.elevenlabs"]!;
    const plugin = factory();
    const currentConnection = connection("ai-sdk.elevenlabs");
    const [offering] = await plugin.discoverOfferings(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret: "provider-secret", version: 2 }),
        now: new Date("2026-08-28T10:00:00.000Z"),
      },
      currentConnection,
    );
    const adapter = unary(
      await plugin.createAdapter(
        {
          ownerId: "owner-1",
          signal: new AbortController().signal,
          credential: async () => ({ secret: "provider-secret", version: 2 }),
          connection: currentConnection,
        },
        offering!,
      ),
    );
    await adapter.invoke(attemptContext(offering!, { count: 0 }), {
      schemaVersion: 1,
      text: "Bonjour",
      voice: { mode: "exact", voiceId: "voice-fr" },
      output: { container: "mp3" },
      alignment: "none",
    });
    expect(providerCalls).toBe(1);
    expect([...writes[0]!]).toEqual([0xff, 0xfb, 0x90]);
  });

  test("discovers and invokes normalized Deepgram transcription", async () => {
    let providerCalls = 0;
    const factory = createWorkflowProviderPluginFactories({
      artifacts: artifactIo([], Uint8Array.from([1, 2, 3])),
      deepgramFetch: async () => {
        providerCalls += 1;
        return Response.json({
          metadata: { duration: 1.25 },
          results: {
            channels: [
              {
                detected_language: "fr",
                alternatives: [
                  {
                    transcript: "Bonjour",
                    words: [{ word: "Bonjour", start: 0, end: 1.25 }],
                  },
                ],
              },
            ],
          },
        });
      },
    })["ai-sdk.deepgram"]!;
    const plugin = factory();
    const currentConnection = connection("ai-sdk.deepgram");
    const [offering] = await plugin.discoverOfferings(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret: "provider-secret", version: 2 }),
        now: new Date("2026-08-28T10:00:00.000Z"),
      },
      currentConnection,
    );
    expect(offering).toMatchObject({
      capability: "speech.transcribe",
      provider: "deepgram",
      adapterRevision: "ai-sdk-deepgram/3.1.3",
    });
    const value = await plugin.createAdapter(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret: "provider-secret", version: 2 }),
        connection: currentConnection,
      },
      offering!,
    );
    if (!("invoke" in value)) throw new Error("expected unary adapter");
    const result = await value.invoke(attemptContext(offering!, { count: 0 }), {
      schemaVersion: 1,
      source: {
        object: { ownerId: "owner-1", namespace: "files", key: "audio-1" },
        digest,
        byteSize: 3,
        mimeType: "audio/webm",
      },
      mimeType: "audio/webm",
      language: "fr",
      timestamps: "segment",
      diarization: false,
      maximumSeconds: 60,
    });
    expect(providerCalls).toBe(1);
    expect(result).toMatchObject({
      text: "Bonjour",
      language: "fr",
      durationSeconds: 1.25,
    });
  });

  test("streams a Mistral tool call through the real capability adapter without retry", async () => {
    let providerCalls = 0;
    const sse =
      [
        {
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "mistral-small-latest",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: { name: "grades_list", arguments: '{"' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "mistral-small-latest",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: 'classId":"1"}' } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: "mistral-small-latest",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        },
      ]
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join("") + "data: [DONE]\n\n";
    const plugin = createWorkflowProviderPluginFactories({
      artifacts: artifactIo([]),
      mistralLanguageFetch: async (_url, init) => {
        providerCalls += 1;
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer provider-secret",
        );
        const body = JSON.parse(String(init?.body)) as {
          tools?: Array<{ function?: { name?: string } }>;
        };
        expect(body.tools?.[0]?.function?.name).toBe("grades_list");
        return new Response(sse, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    })["avermate.mistral"]!();
    const currentConnection = connection("avermate.mistral");
    const offerings = await plugin.discoverOfferings(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret: "provider-secret", version: 2 }),
        now: new Date("2026-08-28T10:00:00.000Z"),
      },
      currentConnection,
    );
    const offering = offerings.find(
      (candidate) => candidate.capability === "language.generate",
    )!;
    expect(offering.specification).toMatchObject({
      tools: true,
      streaming: true,
    });
    const rawAdapter = await plugin.createAdapter(
      {
        ownerId: "owner-1",
        signal: new AbortController().signal,
        credential: async () => ({ secret: "provider-secret", version: 2 }),
        connection: currentConnection,
      },
      offering,
    );
    if (!("stream" in rawAdapter))
      throw new Error("expected streaming adapter");
    const adapter = rawAdapter as StreamingCapabilityAdapter<
      "language.generate",
      ModelGatewayEvent
    >;
    const events: ModelGatewayEvent[] = [];
    for await (const event of adapter.stream(
      attemptContext(offering, { count: 0 }),
      {
        schemaVersion: 1,
        messages: [
          { role: "user", parts: [{ type: "text", text: "Liste les notes" }] },
        ],
        tools: [
          {
            name: "grades_list",
            description: "List grades for a class",
            inputSchema: {
              type: "object",
              properties: { classId: { type: "string" } },
              required: ["classId"],
              additionalProperties: false,
            },
          },
        ],
        maximumOutputTokens: 512,
        responseFormat: "text",
      },
    )) {
      events.push(event);
    }
    expect(providerCalls).toBe(1);
    expect(events).toContainEqual({
      type: "tool-call-start",
      callId: "call-1",
      toolName: "grades_list",
    });
    expect(events).toContainEqual({ type: "tool-call-end", callId: "call-1" });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
  });
});
