import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  contextBlockSchema,
  type CapabilityAttemptContext,
  type ModelGateway,
  type ModelGatewayEvent,
  type ModelRequest,
  type ProviderConnectionPublicSnapshot,
} from "@avermate/agent-contracts";
import type { ContextAssetResolver } from "../../agent/multimodal-context";
import type { CapabilityArtifactIo } from "../artifact-io";
import { createWorkflowProviderPluginFactories } from "../providers/plugins";
import type { CapabilityRegistryInvoker } from "../registry-invoker";
import { CapabilityRuntime } from "../runtime";
import { CapabilityBackedModelGateway } from "./language-generation";

const image = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const handle = `cah1.${"a".repeat(32)}`;
const sentinelDigest = `sha256:${"a".repeat(64)}`;

function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(text);
}

function request(bytes: Uint8Array = image, mime = "image/png"): ModelRequest {
  return {
    ownerId: "owner-1",
    runId: "run-1",
    modelId: "mistral-small-latest",
    tools: [],
    messages: [
      contextBlockSchema.parse({
        id: "context-1",
        trust: "retrieved-untrusted",
        mediaType: "multipart/mixed",
        content: "OCR fallback",
        sourceRef: "source-1",
        redactions: [],
        parts: [
          {
            type: mime === "application/pdf" ? "pdf-page" : "image",
            assetHandle: handle,
            mime,
            fallbackText: "Triangle rectangle OCR fallback",
            evidence: {
              chunkId: "chunk-1",
              locator: { kind: "pdf", page: 1 },
              digest: digest(bytes),
            },
          },
        ],
      }),
    ],
  };
}

async function fixture(
  input: {
    bytes?: Uint8Array;
    mime?: string;
    textOnly?: boolean;
    resolverOverride?: Partial<
      Awaited<ReturnType<ContextAssetResolver["resolve"]>>
    >;
    maximumBytes?: number;
    mode?: "shadow" | "registry";
  } = {},
) {
  const bytes = input.bytes ?? image;
  const mime = input.mime ?? "image/png";
  const stored = new Map<string, Uint8Array>();
  const artifacts: CapabilityArtifactIo = {
    async write(value) {
      expect(value.ownerId).toBe("owner-1");
      const key = `artifact-${stored.size}`;
      stored.set(key, new Uint8Array(value.bytes));
      return {
        object: { ownerId: value.ownerId, namespace: "files", key },
        digest: `sha256:${digest(value.bytes)}`,
        byteSize: value.bytes.byteLength,
        mimeType: value.mimeType,
      };
    },
    async read(ownerId, artifact) {
      expect(ownerId).toBe("owner-1");
      expect(artifact.object.ownerId).toBe(ownerId);
      const value = stored.get(artifact.object.key)!;
      expect(artifact.digest).toBe(`sha256:${digest(value)}`);
      return value;
    },
  };
  let body: Record<string, unknown> | undefined;
  let providerCalls = 0;
  let resolutions = 0;
  let legacyCalls = 0;
  const operationKeys: string[] = [];
  const plugin = createWorkflowProviderPluginFactories({
    artifacts,
    mistralLanguageFetch: async (_url, init) => {
      providerCalls += 1;
      body = JSON.parse(String(init?.body));
      const chunk = {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "mistral-small-latest",
        choices: [
          { index: 0, delta: { content: "verified" }, finish_reason: "stop" },
        ],
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  })["avermate.mistral"]!();
  const connection: ProviderConnectionPublicSnapshot = {
    schemaVersion: 1,
    id: "connection-1",
    ownerKind: "user",
    ownerId: "owner-1",
    pluginId: plugin.manifest.id,
    pluginVersion: plugin.manifest.version,
    displayName: "Fixture",
    placement: { kind: "direct-byok", origin: "https://api.mistral.ai" },
    configVersion: 1,
    config: {},
    configDigest: sentinelDigest,
    status: "ready",
    revision: 1,
    lastValidatedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const context = {
    ownerId: "owner-1",
    signal: new AbortController().signal,
    credential: async () => ({ secret: "fixture-key", version: 1 }),
    now: new Date(),
  };
  const offerings = await plugin.discoverOfferings(context, connection);
  const offering = offerings.find(
    (item) => item.capability === "language.generate",
  )!;
  const adapter = await plugin.createAdapter(
    { ...context, connection },
    offering,
  );
  if (!("stream" in adapter)) throw new Error("stream expected");
  const registry: Pick<
    CapabilityRegistryInvoker,
    "resolve" | "streamLanguage"
  > = {
    async resolve(value) {
      expect(value.projectId).toBe("project-owned");
      return {
        offeringId: offering.id,
        provider: offering.provider,
        modelId: offering.modelId,
        routeKey: "fixture",
        reason: "fixture",
      };
    },
    async *streamLanguage(value) {
      operationKeys.push(value.idempotencyKey);
      expect(value.projectId).toBe("project-owned");
      expect(value.workflowId).toBe("assistant.chat");
      expect(value.requirements?.inputBytes).toBeGreaterThan(
        input.textOnly ? 0 : bytes.byteLength,
      );
      const attempt: CapabilityAttemptContext = {
        ...context,
        offering,
        operationId: "operation-1",
        attemptId: "attempt-1",
        attemptNumber: 1,
        purpose: value.purpose,
        routePlanDigest: sentinelDigest,
        deadline: new Date(Date.now() + 60_000),
        async authorize() {},
        async emit() {},
        async credential(slot) {
          return {
            connectionId: connection.id,
            slot,
            version: 1,
            attemptId: "attempt-1",
            secret: "fixture-key",
            expiresAt: new Date(Date.now() + 60_000),
          };
        },
      };
      yield* adapter.stream(
        attempt,
        value.request,
      ) as AsyncIterable<ModelGatewayEvent>;
    },
  };
  const delegate: ModelGateway = {
    async *stream() {
      legacyCalls += 1;
      yield { type: "content-delta", delta: "legacy" };
    },
    async listModels() {
      return [];
    },
    async embed() {
      throw new Error("not used");
    },
    async transcribe() {
      throw new Error("not used");
    },
    async estimate() {
      throw new Error("not used");
    },
  };
  const gateway = new CapabilityBackedModelGateway(
    delegate,
    () => ({
      provider: "mistral",
      modelId: "mistral-small-latest",
      modelRevision: "mistral-small-latest/2026-08-22",
      inputModalities: input.textOnly ? ["text"] : ["text", "image", "pdf"],
    }),
    {
      artifacts,
      workflowScope: async () => ({
        projectId: "project-owned",
        workflowId: "assistant.chat",
      }),
      ...(input.maximumBytes
        ? { contextMediaBudgets: { maximumBytesPerPart: input.maximumBytes } }
        : {}),
      contextAssetResolver: {
        async resolve(value) {
          resolutions += 1;
          expect(value.ownerId).toBe("owner-1");
          return {
            ownerId: "owner-1",
            assetId: "asset-1",
            mime,
            byteSize: bytes.byteLength,
            bytes,
            ...input.resolverOverride,
          };
        },
      },
    },
    new CapabilityRuntime({ modeFor: () => input.mode ?? "registry" }),
    registry,
  );
  return {
    gateway,
    request: request(bytes, mime),
    body: () => body,
    providerCalls: () => providerCalls,
    resolutions: () => resolutions,
    writes: () => stored.size,
    legacyCalls: () => legacyCalls,
    operationKeys,
  };
}

async function consume(gateway: ModelGateway, request: ModelRequest) {
  const events: ModelGatewayEvent[] = [];
  for await (const event of gateway.stream(request)) events.push(event);
  return events;
}

describe("capability-backed multimodal gateway", () => {
  test("keys each model step separately while preserving identical-step retry identity", async () => {
    const f = await fixture({ textOnly: true });
    await consume(f.gateway, f.request);
    await consume(f.gateway, f.request);
    await consume(f.gateway, {
      ...f.request,
      messages: [
        ...f.request.messages,
        {
          id: "tool-result",
          trust: "tool-result",
          mediaType: "text/plain",
          content: "Tool returned another fact",
          sourceRef: null,
          redactions: [],
        },
      ],
    });
    expect(f.operationKeys[0]).toBe(f.operationKeys[1]);
    expect(f.operationKeys[2]).not.toBe(f.operationKeys[0]);
  });

  test("reminted opaque handles do not change immutable media retry identity", async () => {
    const f = await fixture();
    await consume(f.gateway, f.request);
    await consume(f.gateway, {
      ...f.request,
      messages: f.request.messages.map((block) =>
        contextBlockSchema.parse({
          ...block,
          parts: block.parts?.map((part) =>
            part.type === "text"
              ? part
              : { ...part, assetHandle: `cah1.${"b".repeat(32)}` },
          ),
        }),
      ),
    });
    expect(f.operationKeys[0]).toBe(f.operationKeys[1]);
  });
  test("delivers verified image bytes to the real AI SDK adapter, not OCR text", async () => {
    const f = await fixture();
    expect(await consume(f.gateway, f.request)).toContainEqual({
      type: "content-delta",
      delta: "verified",
    });
    const payload = JSON.stringify(f.body());
    expect(payload).toContain(
      `data:image/png;base64,${Buffer.from(image).toString("base64")}`,
    );
    expect(payload).not.toContain("assetHandle");
    expect(payload).not.toContain("OCR fallback");
    expect(f.providerCalls()).toBe(1);
    expect(f.writes()).toBe(1);
    expect(f.legacyCalls()).toBe(0);
  });

  test("delivers verified one-page PDF bytes as an actual file part", async () => {
    const bytes = pdf();
    const f = await fixture({ bytes, mime: "application/pdf" });
    await consume(f.gateway, f.request);
    const payload = JSON.stringify(f.body());
    expect(payload).toContain("file_data");
    expect(payload).toContain(Buffer.from(bytes).toString("base64"));
    expect(payload).not.toContain("OCR fallback");
  });

  test("uses explicit fallback only for a text-only model", async () => {
    const f = await fixture({ textOnly: true });
    await consume(f.gateway, f.request);
    expect(JSON.stringify(f.body())).toContain("image OCR/text fallback");
    expect(f.resolutions()).toBe(0);
    expect(f.writes()).toBe(0);
  });

  for (const [name, options, error] of [
    [
      "owner",
      { resolverOverride: { ownerId: "other-owner" } },
      "CONTEXT_ASSET_OWNER_MISMATCH",
    ],
    [
      "MIME",
      { resolverOverride: { mime: "image/jpeg" } },
      "CONTEXT_ASSET_METADATA_MISMATCH",
    ],
    [
      "digest",
      { resolverOverride: { bytes: new Uint8Array(image.byteLength) } },
      "CONTEXT_ASSET_DIGEST_MISMATCH",
    ],
    ["budget", { maximumBytes: 10 }, "CONTEXT_MEDIA_BYTE_LIMIT"],
  ] as const) {
    test(`rejects invalid ${name} before artifacts or provider dispatch`, async () => {
      const f = await fixture(options);
      await expect(consume(f.gateway, f.request)).rejects.toThrow(error);
      expect(f.providerCalls()).toBe(0);
      expect(f.writes()).toBe(0);
      expect(f.legacyCalls()).toBe(0);
    });
  }

  test("shadow does not resolve or write source media for a second registry invocation", async () => {
    const f = await fixture({ mode: "shadow" });
    await consume(f.gateway, f.request);
    expect(f.legacyCalls()).toBe(1);
    expect(f.providerCalls()).toBe(0);
    expect(f.resolutions()).toBe(0);
    expect(f.writes()).toBe(0);
  });
});
