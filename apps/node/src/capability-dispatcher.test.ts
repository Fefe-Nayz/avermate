import { afterEach, describe, expect, test } from "bun:test";
import type {
  ModelGateway,
  NodeCapabilityGrantClaims,
  NodeControlFrame,
  NodeWireBytes,
  ObjectStorageProvider,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeCapabilityOperationDispatcher } from "./capability-dispatcher";
import { canonicalDigest } from "./canonical-json";
import { loadOrCreateNodeIdentity } from "./identity";
import { NodeOperationResultLedger } from "./operation-ledger";
import { LocalNodeProviderTransport } from "./provider-transport";
import { GrantReplayLedger, signCapabilityGrant } from "./protocol";
import { FilesystemLexicalSearchBackend } from "./lexical-store";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("NodeCapabilityOperationDispatcher", () => {
  test("executes and durably replays an exact signed model stream", async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-capability-dispatch-"));
    const core = await loadOrCreateNodeIdentity(join(directory, "core.json"));
    const nodeId = "node-dispatch-test";
    const configRevision = `sha256:${"a".repeat(64)}`;
    const gateway: ModelGateway = {
      async listModels() {
        return [];
      },
      async *stream() {
        yield { type: "content-delta", delta: "bonjour" } as const;
        yield { type: "finish", reason: "stop" } as const;
      },
      async embed() {
        throw new Error("unused");
      },
      async transcribe() {
        throw new Error("unused");
      },
      async estimate() {
        throw new Error("unused");
      },
    };
    const transport = new LocalNodeProviderTransport(nodeId, {
      models: (ownerId) => (ownerId === "user-1" ? gateway : null),
    });
    const published: Array<
      Extract<NodeControlFrame, { type: "operation-result" }>
    > = [];
    let terminal!: () => void;
    let completed = new Promise<void>((resolve) => {
      terminal = resolve;
    });
    const dispatcher = new NodeCapabilityOperationDispatcher({
      nodeId,
      corePublicKeyDer: core.publicKeyDer,
      coreKeyId: core.keyId,
      configRevision: () => configRevision,
      transport,
      grantReplay: new GrantReplayLedger(join(directory, "grants.json")),
      results: new NodeOperationResultLedger({
        path: join(directory, "results.json"),
        maximumBytes: 1024 * 1024,
      }),
      maximumConcurrent: 2,
      publish: async (frame) => {
        published.push(frame);
        if (frame.terminal) terminal();
      },
    });
    await dispatcher.initialize();
    const payload = {
      ownerId: "user-1",
      input: {
        ownerId: "user-1",
        runId: "run-1",
        modelId: "model-1",
        messages: [
          {
            id: "context-1",
            trust: "user-instruction",
            mediaType: "text/plain",
            content: "Bonjour",
            sourceRef: null,
            redactions: [],
          },
        ],
        tools: [],
      },
    };
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const requestDigest = canonicalDigest({
      nodeId,
      userId: "user-1",
      capability: "models",
      capabilityVersion: 1,
      operationId: "operation-1",
      operation: "model.stream",
      payload,
      configRevision,
      deadline,
    });
    const claims: NodeCapabilityGrantClaims = {
      version: 1,
      issuer: "core",
      audience: nodeId,
      subject: "user-1",
      nodeId,
      userId: "user-1",
      actorKind: "system",
      jobId: "operation-1",
      jti: "grant-operation-1",
      operation: "model.stream",
      requestDigest,
      configRevision,
      capabilities: ["node:models:model.stream"],
      resources: [],
      limits: {
        byteLimit: 128 * 1024,
        tokenLimit: 10_000,
        costMinorLimit: 1_000,
        deadline,
      },
      notBefore: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: deadline,
      issuedAt: new Date().toISOString(),
    };
    const frame: Extract<NodeControlFrame, { type: "operation-request" }> = {
      type: "operation-request",
      frameId: "frame-request",
      nodeId,
      connectionEpoch: 1,
      operationId: "operation-1",
      capability: "models",
      capabilityVersion: 1,
      operation: "model.stream",
      configRevision,
      deadline,
      grant: signCapabilityGrant(core, claims),
      payload,
    };
    expect(await dispatcher.accept(frame)).toEqual({
      accepted: true,
      replayed: false,
    });
    await completed;
    expect(published.map((result) => result.sequence)).toEqual([1, 2, 3]);
    expect(published.at(-1)).toMatchObject({ ok: true, terminal: true });

    published.splice(0);
    completed = new Promise<void>((resolve) => {
      terminal = resolve;
    });
    expect(await dispatcher.accept(frame)).toEqual({
      accepted: true,
      replayed: true,
    });
    await completed;
    expect(published.map((result) => result.sequence)).toEqual([1, 2, 3]);
  });

  test("rejects a signed grant when the payload revision is changed", async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-capability-dispatch-"));
    const core = await loadOrCreateNodeIdentity(join(directory, "core.json"));
    const transport = new LocalNodeProviderTransport("node-1", {});
    const dispatcher = new NodeCapabilityOperationDispatcher({
      nodeId: "node-1",
      corePublicKeyDer: core.publicKeyDer,
      coreKeyId: core.keyId,
      configRevision: () => `sha256:${"a".repeat(64)}`,
      transport,
      grantReplay: new GrantReplayLedger(join(directory, "grants.json")),
      results: new NodeOperationResultLedger({
        path: join(directory, "results.json"),
        maximumBytes: 1024 * 1024,
      }),
      maximumConcurrent: 1,
      publish: async () => undefined,
    });
    await dispatcher.initialize();
    const now = new Date();
    const deadline = new Date(now.getTime() + 60_000).toISOString();
    const claims: NodeCapabilityGrantClaims = {
      version: 1,
      issuer: "core",
      audience: "node-1",
      subject: "user-1",
      nodeId: "node-1",
      userId: "user-1",
      actorKind: "system",
      jobId: "operation-forged",
      jti: "grant-forged",
      operation: "lexical.verify",
      requestDigest: `sha256:${"b".repeat(64)}`,
      configRevision: `sha256:${"a".repeat(64)}`,
      capabilities: ["node:retrieval:lexical.verify"],
      resources: [],
      limits: {
        byteLimit: 1024,
        tokenLimit: 0,
        costMinorLimit: 0,
        deadline,
      },
      notBefore: new Date(now.getTime() - 1_000).toISOString(),
      expiresAt: deadline,
      issuedAt: now.toISOString(),
    };
    await expect(
      dispatcher.accept({
        type: "operation-request",
        frameId: "frame-forged",
        nodeId: "node-1",
        connectionEpoch: 1,
        operationId: "operation-forged",
        capability: "retrieval",
        capabilityVersion: 1,
        operation: "lexical.verify",
        configRevision: `sha256:${"a".repeat(64)}`,
        deadline,
        grant: signCapabilityGrant(core, claims),
        payload: { ownerId: "user-1", input: { changed: true } },
      }),
    ).rejects.toThrow("GRANT_OPERATION_BINDING_INVALID");
  });

  test("returns exact owner-bound chunks through a signed retrieval grant", async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-capability-lexical-"));
    const core = await loadOrCreateNodeIdentity(join(directory, "core.json"));
    const nodeId = "node-lexical-test";
    const ownerId = "user-lexical";
    const configRevision = `sha256:${"c".repeat(64)}`;
    const text = "Le discriminant vaut b² - 4ac.";
    const digest = createHash("sha256").update(text).digest("hex");
    const lexical = new FilesystemLexicalSearchBackend({
      path: join(directory, "lexical.json"),
      ownerId,
      maximumBytes: 1024 * 1024,
    });
    await lexical.upsertVersion({
      ownerId,
      source: {
        id: "source-lexical",
        ownerId,
        originKind: "material",
        originId: "material-lexical",
        yearId: null,
        subjectId: null,
        currentVersionId: "version-lexical",
        status: "ready",
        coverage: "searchable-native-text",
        placement: { kind: "node", nodeId },
        placementRef: nodeId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      version: {
        id: "version-lexical",
        sourceId: "source-lexical",
        versionKey: "v1",
        contentHash: digest,
        extractorId: "fixture",
        extractorVersion: "1",
        mimeType: "text/plain",
        language: "fr",
        byteSize: text.length,
        locatorSchemaVersion: 1,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
      chunks: [{
        chunkId: "chunk-lexical",
        ordinal: 0,
        text,
        normalizedText: text.toLowerCase(),
        tokenEstimate: 8,
        contentHash: digest,
        locator: { kind: "text", startOffset: 0, endOffset: text.length },
        headingPath: null,
        evidenceKind: "native-text",
      }],
    });
    const transport = new LocalNodeProviderTransport(nodeId, {
      lexical: (requestedOwner) =>
        requestedOwner === ownerId ? lexical : null,
    });
    const published: Array<
      Extract<NodeControlFrame, { type: "operation-result" }>
    > = [];
    let terminal!: () => void;
    const completed = new Promise<void>((resolve) => (terminal = resolve));
    const dispatcher = new NodeCapabilityOperationDispatcher({
      nodeId,
      corePublicKeyDer: core.publicKeyDer,
      coreKeyId: core.keyId,
      configRevision: () => configRevision,
      transport,
      grantReplay: new GrantReplayLedger(join(directory, "lexical-grants.json")),
      results: new NodeOperationResultLedger({
        path: join(directory, "lexical-results.json"),
        maximumBytes: 1024 * 1024,
      }),
      maximumConcurrent: 1,
      publish: async (frame) => {
        published.push(frame);
        if (frame.terminal) terminal();
      },
    });
    await dispatcher.initialize();
    const operationId = "operation-lexical-get-chunks";
    const operation = "lexical.get-chunks" as const;
    const payload = { ownerId, input: { chunkIds: ["chunk-lexical"] } };
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const claims: NodeCapabilityGrantClaims = {
      version: 1,
      issuer: "core",
      audience: nodeId,
      subject: ownerId,
      nodeId,
      userId: ownerId,
      actorKind: "system",
      jobId: operationId,
      jti: "grant-lexical-get-chunks",
      operation,
      requestDigest: canonicalDigest({
        nodeId,
        userId: ownerId,
        capability: "retrieval",
        capabilityVersion: 1,
        operationId,
        operation,
        payload,
        configRevision,
        deadline,
      }),
      configRevision,
      capabilities: [`node:retrieval:${operation}`],
      resources: [],
      limits: {
        byteLimit: 128 * 1024,
        tokenLimit: 0,
        costMinorLimit: 0,
        deadline,
      },
      notBefore: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: deadline,
      issuedAt: new Date().toISOString(),
    };
    await dispatcher.accept({
      type: "operation-request",
      frameId: "frame-lexical-get-chunks",
      nodeId,
      connectionEpoch: 1,
      operationId,
      capability: "retrieval",
      capabilityVersion: 1,
      operation,
      configRevision,
      deadline,
      grant: signCapabilityGrant(core, claims),
      payload,
    });
    await completed;
    expect(published[0]).toMatchObject({
      ok: true,
      terminal: false,
      payload: [{ chunkId: "chunk-lexical", text }],
    });
    expect(published.at(-1)).toMatchObject({ ok: true, terminal: true });
  });

  test("streams a granted owner-bound object as bounded binary frames", async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-capability-storage-"));
    const core = await loadOrCreateNodeIdentity(join(directory, "core.json"));
    const nodeId = "node-storage-test";
    const ownerId = "user-1";
    const configRevision = `sha256:${"a".repeat(64)}`;
    const bytes = new Uint8Array(220_000).fill(7);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
    const ref = { ownerId, namespace: "artifacts", key: "jobs/output.bin" };
    const metadata = {
      ref,
      byteSize: bytes.byteLength,
      mimeType: "application/octet-stream",
      digest,
      etag: digest,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    };
    const storage = {
      id: "fixture-storage",
      async stat() {
        return metadata;
      },
      async get() {
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      },
    } as unknown as ObjectStorageProvider;
    const transport = new LocalNodeProviderTransport(nodeId, { storage });
    const published: Array<
      Extract<NodeControlFrame, { type: "operation-result" }>
    > = [];
    let terminal!: () => void;
    const completed = new Promise<void>((resolve) => (terminal = resolve));
    const dispatcher = new NodeCapabilityOperationDispatcher({
      nodeId,
      corePublicKeyDer: core.publicKeyDer,
      coreKeyId: core.keyId,
      configRevision: () => configRevision,
      transport,
      grantReplay: new GrantReplayLedger(join(directory, "storage-grants.json")),
      results: new NodeOperationResultLedger({
        path: join(directory, "storage-results.json"),
        maximumBytes: 2 * 1024 * 1024,
      }),
      maximumConcurrent: 1,
      publish: async (frame) => {
        published.push(frame);
        if (frame.terminal) terminal();
      },
    });
    await dispatcher.initialize();
    const payload = {
      ownerId,
      input: { ref, maxBytes: bytes.byteLength },
    };
    const deadline = new Date(Date.now() + 60_000).toISOString();
    const operationId = "operation-storage-get";
    const requestDigest = canonicalDigest({
      nodeId,
      userId: ownerId,
      capability: "storage",
      capabilityVersion: 1,
      operationId,
      operation: "storage.get",
      payload,
      configRevision,
      deadline,
    });
    const claims: NodeCapabilityGrantClaims = {
      version: 1,
      issuer: "core",
      audience: nodeId,
      subject: ownerId,
      nodeId,
      userId: ownerId,
      actorKind: "system",
      jobId: operationId,
      jti: "grant-storage-get",
      operation: "storage.get",
      requestDigest,
      configRevision,
      capabilities: ["node:storage:storage.get"],
      resources: [ref],
      limits: {
        byteLimit: 512 * 1024,
        tokenLimit: 0,
        costMinorLimit: 0,
        deadline,
      },
      notBefore: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: deadline,
      issuedAt: new Date().toISOString(),
    };
    await dispatcher.accept({
      type: "operation-request",
      frameId: "frame-storage-get",
      nodeId,
      connectionEpoch: 1,
      operationId,
      capability: "storage",
      capabilityVersion: 1,
      operation: "storage.get",
      configRevision,
      deadline,
      grant: signCapabilityGrant(core, claims),
      payload,
    });
    await completed;
    const chunks = published
      .filter((frame) => frame.ok && !frame.terminal)
      .map((frame) => frame.payload as NodeWireBytes)
      .map((wire) => new Uint8Array(Buffer.from(wire.data, "base64url")));
    expect(chunks.length).toBeGreaterThan(1);
    const received = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    expect(received.equals(Buffer.from(bytes))).toBe(true);
    expect(published.at(-1)).toMatchObject({ ok: true, terminal: true });
  });
});
