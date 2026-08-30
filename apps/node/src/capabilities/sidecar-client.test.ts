import { afterEach, describe, expect, test } from "bun:test";
import { emptyCapabilityUsage, nodeCapabilityRequestDigestPayload } from "@avermate/agent-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../canonical-json";
import { NodeSecretStore } from "../secret-store";
import { createNodeCapabilityOffering } from "./manifest";
import { NodeCapabilitySecretCustody } from "./secret-store";
import { NodeCapabilityHttpSidecarAdapter } from "./sidecar-client";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function offering() {
  const configRevision = `sha256:${"1".repeat(64)}`;
  return createNodeCapabilityOffering({
    descriptor: {
      schemaVersion: 1,
      connectionId: "sidecar-connection",
      connectionRevision: 1,
      pluginId: "avermate.node.sidecar",
      pluginVersion: "1",
      adapterRevision: "sidecar-v1",
      capability: "language.generate",
      capabilityProtocolVersion: 1,
      provider: "custom-sidecar",
      modelId: "custom-model",
      modelRevision: "custom-model-r1",
      placement: { kind: "node", nodeId: "node-sidecar", configRevision },
      dataHandling: {
        egress: "owner-node",
        providerName: null,
        region: null,
        disclosureRevision: "node-sidecar-v1",
        retentionDisclosureRevision: null,
        trainingDisclosureRevision: null,
        requiresExplicitConsent: false,
      },
      limits: {
        maxInputBytes: 1024 * 1024,
        maxOutputBytes: 1024 * 1024,
        maxBatchSize: 1,
        maxConcurrency: 1,
      },
      supportedLanguages: "unknown",
      healthCheckKind: "active-probe",
      specification: {
        inputModalities: ["text"],
        contextWindow: 4_096,
        maximumOutputTokens: 1_024,
        tools: false,
        parallelTools: false,
        structuredOutput: false,
        streaming: true,
        reasoningSummary: false,
        opaqueReasoningContinuation: false,
        cachedUsage: false,
      },
    },
    runtime: {
      implementation: "avermate-capability-http",
      runtimeRevision: "sidecar-runtime-r1",
      imageDigest: null,
      modelRevision: "custom-model-r1",
    },
    egressPolicyDigest: `sha256:${"2".repeat(64)}`,
  });
}

describe("NodeCapabilityHttpSidecarAdapter", () => {
  test("keeps its private endpoint/credential local and validates unary, stream and health", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-sidecar-test-"));
    roots.push(root);
    const secrets = new NodeSecretStore(join(root, "secrets"));
    await secrets.put("sidecar-token", "private-sidecar-credential");
    const custody = new NodeCapabilitySecretCustody(secrets);
    const advertised = offering();
    custody.bind({
      offeringId: advertised.descriptor.id,
      slot: "apiKey",
      reference: "secret:sidecar-token",
      version: 2,
    });
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const requestDraft = {
      schemaVersion: 1 as const,
      operationId: "operation-sidecar",
      ownerId: "owner-sidecar",
      capability: "language.generate" as const,
      purpose: "assistant.chat",
      offeringId: advertised.descriptor.id,
      offeringDigest: advertised.descriptorDigest,
      configRevision: `sha256:${"1".repeat(64)}`,
      requestDigest: `sha256:${"0".repeat(64)}`,
      inputArtifacts: [],
      input: { text: "bonjour" },
    };
    const request = {
      ...requestDraft,
      requestDigest: canonicalDigest(
        nodeCapabilityRequestDigestPayload(requestDraft),
      ),
    };
    const resultValue = { text: "salut" };
    const outputArtifacts: [] = [];
    const result = {
      schemaVersion: 1 as const,
      operationId: request.operationId,
      offeringId: request.offeringId,
      requestDigest: request.requestDigest,
      outputDigest: canonicalDigest({ result: resultValue, outputArtifacts }),
      result: resultValue,
      outputArtifacts,
      usage: emptyCapabilityUsage(),
      providerRequestId: null,
    };
    const adapter = new NodeCapabilityHttpSidecarAdapter({
      offering: advertised,
      invocationModes: ["unary-relay", "stream-relay", "artifact-job"],
      baseUrl: "http://127.0.0.1:9488/private-capability",
      credentialSlot: "apiKey",
      healthCredential: (slot) => custody.credential(advertised.descriptor.id, slot),
      fetch: async (target, init) => {
        const url = String(target);
        const headers = new Headers(init?.headers);
        requests.push({
          url,
          authorization: headers.get("authorization"),
        });
        if (url.endsWith("/stream")) {
          return new Response(
            `${JSON.stringify({
              schemaVersion: 1,
              operationId: request.operationId,
              offeringId: request.offeringId,
              sequence: 0,
              type: "completed",
              payload: null,
            })}\n`,
            { headers: { "content-type": "application/x-ndjson" } },
          );
        }
        return new Response(
          url.endsWith("/health") ? "{}" : JSON.stringify(result),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    const context = {
      ownerId: request.ownerId,
      operationId: request.operationId,
      deadline: new Date(Date.now() + 30_000).toISOString(),
      signal: new AbortController().signal,
      credential: (slot: string) =>
        custody.credential(advertised.descriptor.id, slot),
    };
    expect(await adapter.invoke(context, request)).toEqual(result);
    const events = [];
    for await (const event of adapter.stream(context, request)) {
      events.push(event.type);
    }
    expect(events).toEqual(["completed"]);
    await expect(adapter.health()).resolves.toBeUndefined();
    expect(requests).toHaveLength(3);
    expect(requests.every((entry) => entry.authorization === "Bearer private-sidecar-credential")).toBe(true);
    expect(JSON.stringify(advertised)).not.toContain("127.0.0.1");
    expect(JSON.stringify(advertised)).not.toContain("private-sidecar-credential");
  });

  test("denies redirects instead of following an untrusted sidecar target", async () => {
    const advertised = offering();
    const adapter = new NodeCapabilityHttpSidecarAdapter({
      offering: advertised,
      invocationModes: ["unary-relay"],
      baseUrl: "http://127.0.0.1:9488",
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    });
    const draft = {
      schemaVersion: 1 as const,
      operationId: "redirect-attempt",
      ownerId: "owner-sidecar",
      capability: "language.generate" as const,
      purpose: "assistant.chat",
      offeringId: advertised.descriptor.id,
      offeringDigest: advertised.descriptorDigest,
      configRevision: `sha256:${"1".repeat(64)}`,
      requestDigest: `sha256:${"0".repeat(64)}`,
      inputArtifacts: [],
      input: { text: "bonjour" },
    };
    const request = {
      ...draft,
      requestDigest: canonicalDigest(nodeCapabilityRequestDigestPayload(draft)),
    };
    await expect(
      adapter.invoke(
        {
          ownerId: request.ownerId,
          operationId: request.operationId,
          deadline: new Date(Date.now() + 30_000).toISOString(),
          signal: new AbortController().signal,
          credential: async () => null,
        },
        request,
      ),
    ).rejects.toThrow("NODE_CAPABILITY_SIDECAR_REDIRECT_DENIED");
  });

  test("revalidates DNS before reading a credential or contacting a sidecar", async () => {
    const advertised = offering();
    let fetched = false;
    let credentialRead = false;
    const adapter = new NodeCapabilityHttpSidecarAdapter({
      offering: advertised,
      invocationModes: ["unary-relay"],
      baseUrl: "http://speech-sidecar:9488",
      credentialSlot: "apiKey",
      resolveHostname: async () => ["8.8.8.8"],
      fetch: async () => {
        fetched = true;
        return new Response("{}");
      },
    });
    const draft = {
      schemaVersion: 1 as const,
      operationId: "dns-rebind-attempt",
      ownerId: "owner-sidecar",
      capability: "language.generate" as const,
      purpose: "assistant.chat",
      offeringId: advertised.descriptor.id,
      offeringDigest: advertised.descriptorDigest,
      configRevision: `sha256:${"1".repeat(64)}`,
      requestDigest: `sha256:${"0".repeat(64)}`,
      inputArtifacts: [],
      input: { text: "bonjour" },
    };
    const request = {
      ...draft,
      requestDigest: canonicalDigest(nodeCapabilityRequestDigestPayload(draft)),
    };
    await expect(
      adapter.invoke(
        {
          ownerId: request.ownerId,
          operationId: request.operationId,
          deadline: new Date(Date.now() + 30_000).toISOString(),
          signal: new AbortController().signal,
          credential: async () => {
            credentialRead = true;
            return { value: "must-not-leak", version: 1 };
          },
        },
        request,
      ),
    ).rejects.toThrow("NODE_CAPABILITY_SIDECAR_SSRF_DENIED");
    expect(credentialRead).toBe(false);
    expect(fetched).toBe(false);
  });

  test("pins an approved private DNS answer for the actual HTTP request", async () => {
    const advertised = offering();
    let targetUrl = "";
    let hostHeader = "";
    const adapter = new NodeCapabilityHttpSidecarAdapter({
      offering: advertised,
      invocationModes: ["unary-relay"],
      baseUrl: "http://speech-sidecar:9488",
      resolveHostname: async () => ["10.12.0.7"],
      fetch: async (target, init) => {
        targetUrl = String(target);
        hostHeader = new Headers(init?.headers).get("host") ?? "";
        return Response.json({});
      },
    });
    await adapter.health();
    expect(new URL(targetUrl).hostname).toBe("10.12.0.7");
    expect(hostHeader).toBe("speech-sidecar:9488");
  });
});
