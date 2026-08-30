import { describe, expect, test } from "bun:test";
import type {
  CapabilityAttemptContext,
  ModelGatewayEvent,
  ProviderConnectionPublicSnapshot,
  StreamingCapabilityAdapter,
} from "@avermate/agent-contracts";
import { staticProviderPluginRegistry } from "../plugin-registry";
import { createProxyProviderPluginFactories } from "./proxy-plugins";

const digest = `sha256:${"a".repeat(64)}` as const;
const context = {
  ownerId: "owner",
  now: new Date(),
  signal: new AbortController().signal,
  credential: async () => ({ secret: "test-secret", version: 1 }),
};

function connection(pluginId: string): ProviderConnectionPublicSnapshot {
  const liteLlm = pluginId === "avermate.litellm";
  return {
    schemaVersion: 1,
    id: "proxy-connection",
    ownerKind: "user",
    ownerId: "owner",
    pluginId,
    pluginVersion: "1.0.0",
    displayName: "Proxy",
    placement: {
      kind: "direct-byok",
      origin: liteLlm
        ? "https://proxy.example.test"
        : "https://router.huggingface.co",
    },
    configVersion: 1,
    configDigest: digest,
    revision: 1,
    status: "ready",
    config: liteLlm
      ? {
          origin: "https://proxy.example.test",
          modelId: "dedicated-model",
          modelRevision: "deployment-r1",
          singleDeploymentConfirmed: true,
        }
      : { modelId: "owner/model:groq", modelRevision: "weights-r1" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastValidatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function attempt(
  offering: CapabilityAttemptContext["offering"],
): CapabilityAttemptContext {
  return {
    ...context,
    offering,
    operationId: "op",
    attemptId: "attempt",
    attemptNumber: 1,
    purpose: "assistant.chat",
    routePlanDigest: digest,
    deadline: new Date(Date.now() + 30_000),
    authorize: async () => {},
    emit: async () => {},
    credential: async () => ({
      connectionId: offering.connectionId,
      slot: "apiKey",
      version: 1,
      attemptId: "attempt",
      secret: "test-secret",
      expiresAt: new Date(Date.now() + 30_000),
    }),
  };
}

const request = {
  schemaVersion: 1 as const,
  messages: [
    {
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Bonjour" }],
    },
  ],
  tools: [],
  maximumOutputTokens: 128,
  responseFormat: "text" as const,
};

describe("explicit optional proxy plugins", () => {
  test("both catalogue entries have real factories and advertise only implemented chat", async () => {
    for (const pluginId of [
      "avermate.litellm",
      "avermate.huggingface-inference",
    ]) {
      const factory = staticProviderPluginRegistry.require(pluginId);
      const plugin = factory.instantiate!();
      expect(plugin.manifest).toEqual(factory.manifest);
      const current = connection(pluginId);
      const offerings = await plugin.discoverOfferings(context, current);
      expect(offerings).toHaveLength(1);
      expect(offerings[0]).toMatchObject({
        capability: "language.generate",
        specification: {
          tools: false,
          inputModalities: ["text"],
          cachedUsage: false,
        },
      });
      expect(
        (
          await plugin.createAdapter(
            { ...context, connection: current },
            offerings[0]!,
          )
        ).kind,
      ).toBe("language.generate");
      expect(plugin.manifest.capabilities).toEqual(["language.generate"]);
    }
  });

  test("rejects implicit HF routing, unconfirmed proxies, arbitrary options and origins with credentials", () => {
    for (const suffix of ["", ":auto", ":fastest", ":cheapest", ":preferred"]) {
      expect(() =>
        staticProviderPluginRegistry.parseConnectionConfig(
          "avermate.huggingface-inference",
          {
            modelId: `owner/model${suffix}`,
            modelRevision: "v1",
          },
        ),
      ).toThrow();
    }
    const config = connection("avermate.litellm").config;
    for (const patch of [
      { singleDeploymentConfirmed: false },
      { providerOptions: {} },
      { origin: "https://user:secret@proxy.example.test" },
      { origin: "https://proxy.example.test/v1" },
    ]) {
      expect(() =>
        staticProviderPluginRegistry.parseConnectionConfig("avermate.litellm", {
          ...config,
          ...patch,
        }),
      ).toThrow();
    }
  });

  test("validates HF credentials against authenticated identity, not the public model list", async () => {
    const calls: string[] = [];
    const plugin = createProxyProviderPluginFactories({
      validationFetch: async (url, init) => {
        calls.push(String(url));
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer test-secret",
        );
        expect(init?.redirect).toBe("manual");
        return Response.json({ message: "test-secret" }, { status: 401 });
      },
    })["avermate.huggingface-inference"]!();
    const result = await plugin.validateConnection(
      context,
      connection(plugin.manifest.id).config,
    );
    expect(calls).toEqual(["https://huggingface.co/api/whoami-v2"]);
    expect(result).toMatchObject({
      valid: false,
      error: { code: "CREDENTIAL_INVALID" },
    });
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  test("pins the provider identity and immutable revision before adapter creation", async () => {
    const plugin =
      createProxyProviderPluginFactories()["avermate.huggingface-inference"]!();
    const current = connection(plugin.manifest.id);
    const [offering] = await plugin.discoverOfferings(context, current);
    expect(offering!.dataHandling.providerName).toContain("groq");
    await expect(
      plugin.createAdapter(
        { ...context, connection: { ...current, revision: 2 } },
        offering!,
      ),
    ).rejects.toThrow("SNAPSHOT_MISMATCH");
    await expect(
      plugin.discoverOfferings(context, {
        ...current,
        placement: { kind: "direct-byok", origin: "https://wrong.example" },
      }),
    ).rejects.toThrow("ORIGIN_MISMATCH");
  });

  for (const pluginId of [
    "avermate.litellm",
    "avermate.huggingface-inference",
  ]) {
    test(`${pluginId} streams one pinned request with no adapter retry`, async () => {
      let calls = 0;
      const current = connection(pluginId);
      const plugin = createProxyProviderPluginFactories({
        providerFetch: async (url, init) => {
          calls += 1;
          expect(String(url)).toBe(
            `${current.placement.kind === "direct-byok" ? current.placement.origin : ""}/v1/chat/completions`,
          );
          expect(init?.redirect).toBe("manual");
          const body = JSON.parse(String(init?.body));
          expect(body.model).toBe(current.config.modelId);
          if (pluginId === "avermate.litellm") {
            expect(body).toMatchObject({
              disable_fallbacks: true,
              num_retries: 0,
              max_fallbacks: 0,
              fallbacks: [],
              context_window_fallbacks: [],
              content_policy_fallbacks: [],
            });
          }
          const chunks = [
            {
              id: "chat-1",
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: { content: "Bonjour" },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chat-1",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: {
                prompt_tokens: 3,
                completion_tokens: 2,
                total_tokens: 5,
              },
            },
          ];
          return new Response(
            chunks
              .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      })[pluginId]!();
      const [offering] = await plugin.discoverOfferings(context, current);
      const adapter = (await plugin.createAdapter(
        { ...context, connection: current },
        offering!,
      )) as StreamingCapabilityAdapter<"language.generate", ModelGatewayEvent>;
      const events = await Array.fromAsync(
        adapter.stream(attempt(offering!), request),
      );
      expect(calls).toBe(1);
      expect(events).toContainEqual({
        type: "content-delta",
        delta: "Bonjour",
      });
      expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
    });
  }

  test("HTTP failure is terminal for the adapter; executor owns any retry", async () => {
    let calls = 0;
    const plugin = createProxyProviderPluginFactories({
      providerFetch: async () => {
        calls += 1;
        return Response.json(
          { error: { message: "unavailable" } },
          { status: 503 },
        );
      },
    })["avermate.litellm"]!();
    const current = connection(plugin.manifest.id);
    const [offering] = await plugin.discoverOfferings(context, current);
    const adapter = (await plugin.createAdapter(
      { ...context, connection: current },
      offering!,
    )) as StreamingCapabilityAdapter<"language.generate", ModelGatewayEvent>;
    await expect(
      Array.fromAsync(adapter.stream(attempt(offering!), request)),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
