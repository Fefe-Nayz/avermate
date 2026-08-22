import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
  ObjectSha256,
  ObjectStorageMetadata,
  ObjectStorageProvider,
  OwnedObjectRef,
  SandboxCreateInput,
  SandboxExecuteInput,
  SandboxExecutionEvent,
  SandboxFileManifestEntry,
  SandboxHandle,
  SandboxInputFile,
  SandboxProvider,
} from "@avermate/agent-contracts";
import { ObjectStorageManifestStore } from "../ingestion/object-manifest-store";
import type {
  ArtifactStagingUpload,
  TrustedArtifactObjectStore,
} from "./artifact-adoption";
import { MockSandboxProvider } from "./mock-provider";
import { enableSandboxProfile, SANDBOX_PROFILES_V1 } from "./profiles";
import {
  SANDBOX_WORKER_DEFINITIONS,
  SANDBOX_WORKER_IDS,
  resolveSandboxWorkerDefinition,
} from "./worker-definitions";
import { SandboxWorkerClient } from "./worker-client";
import { SandboxWorkerExecutor } from "./worker-executor";

const now = new Date("2026-08-22T12:00:00.000Z");
const hostPolicyDigest = `sha256:${"f".repeat(64)}`;
const imageDigest = `sha256:${"b".repeat(64)}`;
const profile = enableSandboxProfile("browser", {
  version: "browser-worker-fixture-v1",
  imageDigest,
});
const inputManifest = Object.freeze({
  schemaVersion: 1 as const,
  worker: "browser-capture.v1" as const,
  request: {
    schemaVersion: 1 as const,
    url: "https://school.example/lesson",
    wait: { kind: "dom-settled" as const, maxMs: 1_000 },
    maxNavigations: 2,
    maxRequests: 10,
    maxResponseBytes: 1_000_000,
    capture: ["readable-html" as const, "metadata" as const],
  },
  egressPolicyDigest: `sha256:${"e".repeat(64)}`,
});
const workerOutput = Object.freeze({
  schemaVersion: 1 as const,
  finalUrl: "https://school.example/lesson",
  redirectChain: [] as string[],
  title: "Lesson",
  language: "en",
  readableHtml: "<main>Verified lesson</main>",
  requestCount: 1,
  responseBytes: 128,
  selectedImages: [] as unknown[],
});

describe("versioned sandbox worker catalogue", () => {
  test("binds every worker id to one reviewed profile entrypoint", () => {
    expect(Object.keys(SANDBOX_WORKER_DEFINITIONS).sort()).toEqual(
      [...SANDBOX_WORKER_IDS].sort(),
    );
    for (const definition of Object.values(SANDBOX_WORKER_DEFINITIONS)) {
      expect(SANDBOX_PROFILES_V1[definition.profileId].entrypoints).toContain(
        definition.executable,
      );
      expect(definition.argv.every((argument) => !argument.includes("\0"))).toBe(
        true,
      );
      expect(definition.resultPath.startsWith("output/")).toBe(true);
    }
  });

  test("rejects an id/argv combination that was not reviewed", () => {
    const definition = SANDBOX_WORKER_DEFINITIONS["browser-capture.v1"];
    expect(() =>
      resolveSandboxWorkerDefinition({
        workerId: definition.id,
        profileId: definition.profileId,
        executable: definition.executable,
        argv: [...definition.argv, "--shell", "id"],
      }),
    ).toThrow("SANDBOX_WORKER_DEFINITION_NOT_ALLOWED");
    expect(() =>
      resolveSandboxWorkerDefinition({
        workerId: "latex-build.v1",
        profileId: definition.profileId,
        executable: definition.executable,
        argv: definition.argv,
      }),
    ).toThrow("SANDBOX_WORKER_DEFINITION_NOT_ALLOWED");
  });
});

describe("sandbox worker dispatch and adoption", () => {
  test("runs the fixed client worker and verifies its immutable result bytes", async () => {
    const provider = new BrowserFixtureProvider();
    const client = new SandboxWorkerClient({
      provider,
      profiles: [profile],
      hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now: () => now,
    });
    const result = await client.execute({
      workerId: "browser-capture.v1",
      ownerId: "owner",
      threadId: "thread",
      branchId: "branch",
      operationId: "operation",
      manifest: inputManifest,
      maximumReturnBytes: 1024 * 1024,
    });
    const definition = SANDBOX_WORKER_DEFINITIONS["browser-capture.v1"];
    expect(provider.observedExecution).toEqual({
      executable: definition.executable,
      argv: definition.argv,
    });
    expect(result.output).toEqual(workerOutput);
    expect(result.files.get("output/render.json")).toBeInstanceOf(Uint8Array);
    expect(provider.destroyed).toBe(1);
  });

  test("executes a durable manifest and adopts only verified outputs", async () => {
    const provider = new BrowserFixtureProvider();
    const storage = new MemoryObjectStorage();
    const manifests = new ObjectStorageManifestStore(storage, 1024 * 1024);
    const stored = await manifests.put({
      ownerId: "owner",
      namespace: "sandbox-inputs",
      kind: "browser/lesson",
      value: inputManifest,
      idempotencyKey: "manifest-1",
    });
    const preflight = await provider.preflight({
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now,
    });
    if (!preflight.ok) throw new Error(preflight.message);
    const committed: Uint8Array[] = [];
    const executor = new SandboxWorkerExecutor({
      provider,
      profiles: [profile],
      hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      manifests,
      artifacts: () => memoryArtifactStore(committed),
      now: () => now,
    });
    const definition = SANDBOX_WORKER_DEFINITIONS["browser-capture.v1"];
    const result = await executor.execute(
      {
        schemaVersion: 1,
        workerId: definition.id,
        ownerId: "owner",
        threadId: "thread",
        branchId: "branch",
        inputManifestRef: stored.manifestRef,
        workspaceSnapshotRef: null,
        profileId: profile.id,
        profileVersion: profile.version,
        imageDigest: profile.image.imageDigest,
        hostPolicyDigest,
        baselineEvidenceNonce: preflight.evidence.evidenceNonce,
        executable: definition.executable,
        argv: definition.argv,
        resources: { wallTimeMs: 30_000 },
      },
      { jobId: "job-1" },
    );
    expect(result.workerId).toBe("browser-capture.v1");
    expect(result.artifacts).toHaveLength(1);
    expect(committed).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode(committed[0]))).toEqual(
      workerOutput,
    );
    expect(provider.destroyed).toBe(1);
  });

  test("rejects a forged durable command before creating a sandbox", async () => {
    const provider = new BrowserFixtureProvider();
    const storage = new MemoryObjectStorage();
    const manifests = new ObjectStorageManifestStore(storage, 1024 * 1024);
    const stored = await manifests.put({
      ownerId: "owner",
      namespace: "sandbox-inputs",
      kind: "browser/lesson",
      value: inputManifest,
      idempotencyKey: "manifest-2",
    });
    const executor = new SandboxWorkerExecutor({
      provider,
      profiles: [profile],
      hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      manifests,
      artifacts: () => memoryArtifactStore([]),
      now: () => now,
    });
    const definition = SANDBOX_WORKER_DEFINITIONS["browser-capture.v1"];
    await expect(
      executor.execute(
        {
          schemaVersion: 1,
          workerId: definition.id,
          ownerId: "owner",
          threadId: "thread",
          branchId: "branch",
          inputManifestRef: stored.manifestRef,
          workspaceSnapshotRef: null,
          profileId: profile.id,
          profileVersion: profile.version,
          imageDigest: profile.image.imageDigest,
          hostPolicyDigest,
          baselineEvidenceNonce: "fixture-evidence",
          executable: definition.executable,
          argv: [...definition.argv, "--shell", "id"],
          resources: {},
        },
        { jobId: "job-forged" },
      ),
    ).rejects.toThrow("SANDBOX_WORKER_DEFINITION_NOT_ALLOWED");
    expect(provider.created).toBe(0);
  });
});

class BrowserFixtureProvider implements SandboxProvider {
  readonly id = "mock" as const;
  readonly delegate = new MockSandboxProvider({
    allowMock: true,
    hostPolicyDigest,
    profiles: [profile],
    now: () => now,
  });
  readonly files = new Map<string, Map<string, Uint8Array>>();
  observedExecution: { executable: string; argv: readonly string[] } | null = null;
  created = 0;
  destroyed = 0;

  capabilities() {
    return this.delegate.capabilities();
  }

  preflight(input: Parameters<SandboxProvider["preflight"]>[0]) {
    return this.delegate.preflight(input);
  }

  async create(input: SandboxCreateInput) {
    const handle = await this.delegate.create(input);
    this.created += 1;
    this.files.set(handle.sandboxId, new Map());
    return handle;
  }

  async *execute(input: SandboxExecuteInput): AsyncIterable<SandboxExecutionEvent> {
    this.observedExecution = {
      executable: input.executable,
      argv: Object.freeze([...input.argv]),
    };
    const definition = SANDBOX_WORKER_DEFINITIONS["browser-capture.v1"];
    if (
      input.executable !== definition.executable ||
      input.argv.length !== definition.argv.length ||
      input.argv.some((value, index) => value !== definition.argv[index])
    ) {
      throw new Error("FIXTURE_COMMAND_NOT_ALLOWED");
    }
    const bytes = new TextEncoder().encode(`${JSON.stringify(workerOutput)}\n`);
    this.requireFiles(input.handle).set("output/render.json", bytes);
    yield { type: "started", at: now.toISOString() };
    yield { type: "progress", current: 1, total: 1, message: "captured" };
    yield {
      type: "exited",
      at: now.toISOString(),
      exitCode: 0,
      signal: null,
      outputBytes: bytes.byteLength,
    };
  }

  async putFiles(handle: SandboxHandle, files: readonly SandboxInputFile[]) {
    await this.delegate.putFiles(handle, files);
    const state = this.requireFiles(handle);
    for (const file of files) state.set(file.relativePath, file.bytes.slice());
  }

  async getFiles(handle: SandboxHandle, paths: readonly string[]) {
    const state = this.requireFiles(handle);
    return paths.map((path): SandboxFileManifestEntry => {
      const bytes = state.get(path);
      if (!bytes) throw new Error(`FIXTURE_FILE_MISSING:${path}`);
      return {
        relativePath: path,
        digest: digest(bytes),
        byteSize: bytes.byteLength,
        mimeType: path.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
        kind: path.endsWith(".json") ? "json" : "binary",
        nodeType: "file",
      };
    });
  }

  async *readFile(handle: SandboxHandle, relativePath: string) {
    const bytes = this.requireFiles(handle).get(relativePath);
    if (!bytes) throw new Error(`FIXTURE_FILE_MISSING:${relativePath}`);
    yield bytes.slice();
  }

  snapshotWorkspace(handle: SandboxHandle) {
    return this.delegate.snapshotWorkspace(handle);
  }

  forkWorkspace(input: SandboxCreateInput & { source: Parameters<SandboxProvider["forkWorkspace"]>[0]["source"] }) {
    return this.delegate.forkWorkspace(input);
  }

  stop(handle: SandboxHandle) {
    return this.delegate.stop(handle);
  }

  async destroy(handle: SandboxHandle) {
    this.files.delete(handle.sandboxId);
    this.destroyed += 1;
    await this.delegate.destroy(handle);
  }

  private requireFiles(handle: SandboxHandle) {
    const files = this.files.get(handle.sandboxId);
    if (!files) throw new Error("FIXTURE_SANDBOX_MISSING");
    return files;
  }
}

class MemoryObjectStorage implements ObjectStorageProvider {
  readonly id = "worker-memory";
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; metadata: ObjectStorageMetadata }
  >();

  async capabilities() {
    return {
      providerId: this.id,
      maxObjectBytes: 10_000_000,
      maxPartBytes: 10_000_000,
      minPartBytes: 1,
      multipart: false,
      range: true,
      copy: false,
      reconcile: true,
      directTransfer: false,
      checksumAlgorithms: ["sha256"] as ["sha256"],
    };
  }

  async stat(input: { ref: OwnedObjectRef }) {
    return this.objects.get(objectKey(input.ref))?.metadata ?? null;
  }

  async get(input: { ref: OwnedObjectRef; maxBytes?: number }) {
    const object = this.objects.get(objectKey(input.ref));
    if (!object) throw new Error("NOT_FOUND");
    if (input.maxBytes && object.bytes.byteLength > input.maxBytes) {
      throw new Error("MAX_BYTES_EXCEEDED");
    }
    return bytesStream(object.bytes);
  }

  async getRange(input: Parameters<ObjectStorageProvider["getRange"]>[0]) {
    const object = this.objects.get(objectKey(input.ref));
    if (!object) throw new Error("NOT_FOUND");
    const bytes = object.bytes.slice(input.start, input.endInclusive + 1);
    return {
      metadata: object.metadata,
      start: input.start,
      endInclusive: input.start + bytes.byteLength - 1,
      totalBytes: object.bytes.byteLength,
      body: bytesStream(bytes),
    };
  }

  async put(input: Parameters<ObjectStorageProvider["put"]>[0]) {
    const bytes = new Uint8Array(await new Response(input.body).arrayBuffer());
    if (bytes.byteLength !== input.byteSize || digest(bytes) !== input.expectedDigest) {
      throw new Error("CONTENT_MISMATCH");
    }
    const timestamp = now.toISOString();
    const metadata: ObjectStorageMetadata = {
      ref: input.ref,
      byteSize: bytes.byteLength,
      mimeType: input.mimeType,
      digest: input.expectedDigest,
      etag: input.expectedDigest,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const replayed = this.objects.has(objectKey(input.ref));
    this.objects.set(objectKey(input.ref), { bytes, metadata });
    return { ...metadata, replayed };
  }

  async delete(input: Parameters<ObjectStorageProvider["delete"]>[0]) {
    const key = objectKey(input.ref);
    const deleted = this.objects.delete(key);
    return { ref: input.ref, deleted, alreadyAbsent: !deleted };
  }

  beginMultipart(): Promise<never> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }

  uploadPart(): Promise<never> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }

  completeMultipart(): Promise<never> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }

  abortMultipart(): Promise<void> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }

  async *reconcile() {
    for (const object of this.objects.values()) yield object.metadata;
  }

  authorizeTransfer(): Promise<never> {
    return Promise.reject(new Error("UNSUPPORTED"));
  }
}

function memoryArtifactStore(committed: Uint8Array[]): TrustedArtifactObjectStore {
  return {
    async begin(): Promise<ArtifactStagingUpload> {
      const chunks: Uint8Array[] = [];
      let terminal = false;
      return {
        async write(chunk) {
          if (terminal) throw new Error("FIXTURE_UPLOAD_CLOSED");
          chunks.push(chunk.slice());
        },
        async commit(input) {
          if (terminal) throw new Error("FIXTURE_UPLOAD_CLOSED");
          terminal = true;
          const bytes = concatenate(chunks);
          if (bytes.byteLength !== input.byteSize || digest(bytes) !== input.digest) {
            throw new Error("FIXTURE_COMMIT_MISMATCH");
          }
          committed.push(bytes);
          return `fixture:${input.digest}`;
        },
        async abort() {
          terminal = true;
        },
      };
    },
    async revoke() {},
  };
}

function objectKey(ref: OwnedObjectRef) {
  return `${ref.ownerId}\0${ref.namespace}\0${ref.key}`;
}

function digest(bytes: Uint8Array): ObjectSha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice());
      controller.close();
    },
  });
}

function concatenate(chunks: readonly Uint8Array[]) {
  const bytes = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
