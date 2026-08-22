import { afterEach, describe, expect, test } from "bun:test";
import type {
  NodeArtifactRef,
  NodeJobV1,
  ObjectStorageProvider,
  SandboxExecutionProfile,
  SandboxFileManifestEntry,
  SandboxInputFile,
  SandboxProvider,
} from "@avermate/agent-contracts";
import {
  LOCAL_OCR_MODEL_ID,
  LOCAL_TRANSCRIPTION_MODEL_ID,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactSandboxJobHandler,
  configuredArtifactSandboxProfiles,
  createHealthyArtifactHandlers,
} from "./artifact-workers";
import { canonicalDigest } from "./canonical-json";
import { defaultDevZeroConfig, type NodeConfig } from "./config";
import { FilesystemObjectStorageProvider } from "./filesystem-storage";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const hostPolicyDigest = `sha256:${"b".repeat(64)}` as const;

function attestLocalDocumentAiModels(config: NodeConfig) {
  config.models = {
    ...config.models,
    enabled: true,
    gateway: "direct",
    endpoint: "http://models.internal/v1",
    catalogue: [
      {
        id: LOCAL_OCR_MODEL_ID,
        provider: "tesseract+poppler",
        displayName: "Tesseract OCR",
        modalities: ["image"],
        capabilities: {
          tools: false,
          reasoningSummary: false,
          cachedUsage: false,
          structuredOutput: false,
        },
        contextWindow: "unknown",
      },
      {
        id: LOCAL_TRANSCRIPTION_MODEL_ID,
        provider: "whisper.cpp",
        displayName: "Whisper local",
        modalities: ["audio"],
        capabilities: {
          tools: false,
          reasoningSummary: false,
          cachedUsage: false,
          structuredOutput: false,
        },
        contextWindow: "unknown",
      },
    ],
    modelRevisions: {
      [LOCAL_OCR_MODEL_ID]: "tesseract-5.5.1-fra-eng",
      [LOCAL_TRANSCRIPTION_MODEL_ID]: "whisper-large-v3-turbo-q5_0-2026-08",
    },
  };
}

describe("attested deterministic Node artifact workers", () => {
  test("registers only workers compatible with the profile egress policy", async () => {
    const config = defaultDevZeroConfig();
    attestLocalDocumentAiModels(config);
    const mediaDigest = `sha256:${"c".repeat(64)}` as const;
    const browserDigest = `sha256:${"d".repeat(64)}` as const;
    const videoAudioDigest = `sha256:${"e".repeat(64)}` as const;
    const ocrDigest = `sha256:${"f".repeat(64)}` as const;
    const speechDigest = `sha256:${"1".repeat(64)}` as const;
    config.sandbox = {
      ...config.sandbox,
      enabled: true,
      provider: "opensandbox",
      endpoint: "http://opensandbox:8080",
      evidenceEndpoint: "https://attestor.example/evidence",
      hostPolicyDigest,
      isolation: "gvisor",
      images: [
        {
          profileId: "media",
          image: `ghcr.io/avermate/media@${mediaDigest}`,
          digest: mediaDigest,
          architecture: "amd64",
          egress: { mode: "none" },
        },
        {
          profileId: "browser",
          image: `ghcr.io/avermate/browser@${browserDigest}`,
          digest: browserDigest,
          architecture: "amd64",
          egress: {
            mode: "allowlist",
            destinations: [
              {
                protocol: "https",
                hostname: "school.example",
                port: 443,
                pathPrefix: "/",
              },
            ],
            maxRequests: 250,
            maxResponseBytes: 5 * 1024 * 1024,
          },
        },
        {
          profileId: "video-audio",
          image: `ghcr.io/avermate/video-audio@${videoAudioDigest}`,
          digest: videoAudioDigest,
          architecture: "amd64",
          egress: {
            mode: "allowlist",
            destinations: [
              {
                protocol: "https",
                hostname: "www.youtube.com",
                port: 443,
                pathPrefix: "/",
              },
              {
                protocol: "https",
                hostname: "*.googlevideo.com",
                port: 443,
                pathPrefix: "/",
              },
            ],
            maxRequests: 1_000,
            maxResponseBytes: 512 * 1024 * 1024,
          },
        },
        {
          profileId: "ocr",
          image: `ghcr.io/avermate/ocr@${ocrDigest}`,
          digest: ocrDigest,
          architecture: "amd64",
          egress: { mode: "none" },
        },
        {
          profileId: "speech-to-text",
          image: `ghcr.io/avermate/speech-to-text@${speechDigest}`,
          digest: speechDigest,
          architecture: "amd64",
          egress: { mode: "none" },
        },
      ],
    };
    const profiles = configuredArtifactSandboxProfiles(config);
    const provider = evidenceProvider(profiles);
    const storage = await filesystemStorage();
    const handlers = await createHealthyArtifactHandlers({
      config,
      provider,
      profiles,
      storage,
    });
    expect(handlers.map((handler) => `${handler.kind}@1`).sort()).toEqual([
      "artifact.browser-render@1",
      "artifact.compose-thumbnail@1",
      "artifact.corpus-derivatives@1",
      "artifact.local-ocr@1",
      "artifact.local-transcription@1",
      "artifact.render-video@1",
      "artifact.video-audio-extract@1",
    ]);
    expect(
      handlers
        .find((handler) => handler.kind === "artifact.browser-render")
        ?.executionProfile(),
    ).toEqual({
      kind: "artifact.browser-render@1",
      sandboxProfileId: "browser",
      profileVersion: profiles.find((profile) => profile.id === "browser")!
        .version,
      imageDigest: browserDigest,
      egressPolicyDigest: canonicalDigest(
        profiles.find((profile) => profile.id === "browser")!.egress,
      ),
    });
    expect(
      handlers
        .filter((handler) =>
          ["artifact.local-ocr", "artifact.local-transcription"].includes(
            handler.kind,
          ),
        )
        .map((handler) => handler.executionProfile()),
    ).toEqual([
      expect.objectContaining({
        kind: "artifact.local-ocr@1",
        sandboxProfileId: "ocr",
        imageDigest: ocrDigest,
      }),
      expect.objectContaining({
        kind: "artifact.local-transcription@1",
        sandboxProfileId: "speech-to-text",
        imageDigest: speechDigest,
      }),
    ]);

    const ocrHandler = handlers.find(
      (handler) => handler.kind === "artifact.local-ocr",
    )!;
    const ocrSource = await store(
      storage,
      "owner-a",
      "materials",
      "ocr-source.png",
      new TextEncoder().encode("local-ocr-source"),
      "image/png",
    );
    const staleModelRequest = {
      schemaVersion: 1,
      worker: "local-ocr.v1",
      execution: { threadId: "thread-ocr", branchId: "branch-ocr" },
      inputs: [{ path: "input/source", artifact: ocrSource }],
      manifest: {
        schemaVersion: 1,
        worker: "local-ocr.v1",
        source: {
          path: "input/source",
          digest: ocrSource.digest,
          byteSize: ocrSource.byteSize,
          mimeType: ocrSource.mimeType,
        },
        language: "fra+eng",
        maximumPages: 1,
        maximumPixelsPerPage: 16_777_216,
        maximumTotalPixels: 16_777_216,
        modelId: LOCAL_OCR_MODEL_ID,
        modelRevision: "stale-tesseract-revision",
      },
    };
    const staleManifest = await store(
      storage,
      "owner-a",
      "sandbox-inputs",
      "local-ocr-stale-model.json",
      new TextEncoder().encode(JSON.stringify(staleModelRequest)),
      "application/json",
    );
    const exactJob = artifactJob(
      staleManifest,
      staleManifest.byteSize + ocrSource.byteSize,
      ocrHandler.executionProfile(),
    );
    await expect(
      ocrHandler.execute({
        job: exactJob,
        grantedResources: [staleManifest.object, ocrSource.object],
        signal: new AbortController().signal,
        progress: async () => undefined,
      }),
    ).rejects.toThrow("ARTIFACT_WORKER_MODEL_ATTESTATION_MISMATCH");
    await expect(
      ocrHandler.execute({
        job: {
          ...exactJob,
          executionProfile: {
            ...exactJob.executionProfile!,
            imageDigest: `sha256:${"9".repeat(64)}`,
          },
        },
        grantedResources: [staleManifest.object, ocrSource.object],
        signal: new AbortController().signal,
        progress: async () => undefined,
      }),
    ).rejects.toThrow("ARTIFACT_WORKER_EXECUTION_ATTESTATION_MISMATCH");

    delete config.models.modelRevisions[LOCAL_TRANSCRIPTION_MODEL_ID];
    const withoutSttModel = await createHealthyArtifactHandlers({
      config,
      provider,
      profiles,
      storage,
    });
    expect(
      withoutSttModel.some(
        (handler) => handler.kind === "artifact.local-transcription",
      ),
    ).toBe(false);
    expect(
      withoutSttModel.some((handler) => handler.kind === "artifact.local-ocr"),
    ).toBe(true);
  });

  test("executes an exact thumbnail manifest and adopts verified outputs", async () => {
    const config = defaultDevZeroConfig();
    const digest = `sha256:${"e".repeat(64)}` as const;
    config.sandbox = {
      ...config.sandbox,
      enabled: true,
      provider: "opensandbox",
      endpoint: "http://opensandbox:8080",
      evidenceEndpoint: "https://attestor.example/evidence",
      hostPolicyDigest,
      isolation: "gvisor",
      images: [
        {
          profileId: "media",
          image: `ghcr.io/avermate/media@${digest}`,
          digest,
          architecture: "amd64",
          egress: { mode: "none" },
        },
      ],
    };
    const profile = configuredArtifactSandboxProfiles(config)[0]!;
    const storage = await filesystemStorage();
    const source = await store(
      storage,
      "owner-a",
      "materials",
      "source.png",
      new TextEncoder().encode("owned-png-fixture"),
      "image/png",
    );
    const previewBytes = new TextEncoder().encode("reviewed-webp-fixture");
    const previewDigest = sha256(previewBytes);
    const resultBytes = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        worker: "material-preview.v1",
        preview: {
          path: "output/preview.webp",
          digest: previewDigest,
          byteSize: previewBytes.byteLength,
          mimeType: "image/webp",
        },
        width: 512,
        height: 320,
      }),
    );
    const provider = evidenceProvider(profile, {
      "output/preview.webp": {
        bytes: previewBytes,
        kind: "webp",
        mimeType: "image/webp",
      },
      "output/preview.json": {
        bytes: resultBytes,
        kind: "json",
        mimeType: "application/json",
      },
    });
    const request = {
      schemaVersion: 1,
      worker: "material-preview.v1",
      execution: { threadId: "thread-a", branchId: "branch-a" },
      manifest: {
        schemaVersion: 1,
        worker: "material-preview.v1",
        source: {
          path: "input/source",
          digest: source.digest,
          byteSize: source.byteSize,
          mimeType: source.mimeType,
        },
        maximumDimension: 512,
      },
      inputs: [{ path: "input/source", artifact: source }],
    } as const;
    const manifest = await store(
      storage,
      "owner-a",
      "sandbox-inputs",
      "thumbnail-request.json",
      new TextEncoder().encode(JSON.stringify(request)),
      "application/json",
    );
    const handler = new ArtifactSandboxJobHandler({
      kind: "artifact.compose-thumbnail",
      provider,
      profile,
      hostPolicyDigest,
      maxEvidenceAgeMs: 300_000,
      storage,
    });
    const job = artifactJob(
      manifest,
      source.byteSize + manifest.byteSize,
      handler.executionProfile(),
    );
    const output = await handler.execute({
      job,
      grantedResources: [manifest.object, source.object],
      signal: new AbortController().signal,
      progress: async () => undefined,
    });
    expect(output).toHaveLength(2);
    expect(output.map((artifact) => artifact.mimeType).sort()).toEqual([
      "application/json",
      "image/webp",
    ]);
    expect(provider.uploadedPaths()).toEqual([
      "input/request.json",
      "input/source",
    ]);
    await expect(
      handler.execute({
        job,
        grantedResources: [manifest.object],
        signal: new AbortController().signal,
        progress: async () => undefined,
      }),
    ).rejects.toThrow("ARTIFACT_WORKER_RESOURCE_AUTHORITY_MISMATCH");

    for (const artifact of output) {
      await storage.delete({
        ref: artifact.object,
        expectedDigest: artifact.digest as `sha256:${string}`,
        idempotencyKey: `test-clean-${artifact.object.key}`,
      });
    }
    for (const boundary of [
      "stat",
      "get",
      "getFiles",
      "readFile",
      "put",
    ] as const) {
      let reached!: () => void;
      const atBoundary = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const blocked = new Promise<never>(() => undefined);
      const boundaryStorage = storageBoundary(
        storage,
        boundary,
        reached,
        blocked,
      );
      const boundaryProvider = providerBoundary(
        provider,
        boundary,
        reached,
        blocked,
      );
      const boundaryHandler = new ArtifactSandboxJobHandler({
        kind: "artifact.compose-thumbnail",
        provider: boundaryProvider,
        profile,
        hostPolicyDigest,
        maxEvidenceAgeMs: 300_000,
        storage: boundaryStorage,
      });
      const controller = new AbortController();
      const running = boundaryHandler.execute({
        job,
        grantedResources: [manifest.object, source.object],
        signal: controller.signal,
        progress: async () => undefined,
      });
      await atBoundary;
      controller.abort(new Error(`cancel-${boundary}`));
      await expect(running).rejects.toThrow(`cancel-${boundary}`);
      expect(await artifactResultCount(storage, "owner-a")).toBe(0);
    }

    let deadlineReached!: () => void;
    const atDeadlineBoundary = new Promise<void>((resolve) => {
      deadlineReached = resolve;
    });
    const deadlineHandler = new ArtifactSandboxJobHandler({
      kind: "artifact.compose-thumbnail",
      provider,
      profile,
      hostPolicyDigest,
      maxEvidenceAgeMs: 300_000,
      storage: storageBoundary(
        storage,
        "stat",
        deadlineReached,
        new Promise<never>(() => undefined),
      ),
    });
    const deadlineRun = deadlineHandler.execute({
      job: {
        ...job,
        limits: {
          ...job.limits,
          deadline: new Date(Date.now() + 25).toISOString(),
        },
      },
      grantedResources: [manifest.object, source.object],
      signal: new AbortController().signal,
      progress: async () => undefined,
    });
    await atDeadlineBoundary;
    await expect(deadlineRun).rejects.toThrow(
      "ARTIFACT_WORKER_DEADLINE_EXPIRED",
    );

    let lateReached!: () => void;
    const atLateStore = new Promise<void>((resolve) => {
      lateReached = resolve;
    });
    let resolveLate!: (
      value: Awaited<ReturnType<ObjectStorageProvider["put"]>>,
    ) => void;
    const lateCommit = new Promise<
      Awaited<ReturnType<ObjectStorageProvider["put"]>>
    >((resolve) => {
      resolveLate = resolve;
    });
    let capturedPut: Parameters<ObjectStorageProvider["put"]>[0] | null = null;
    const lateStorage = new Proxy(storage, {
      get(target, property) {
        if (property === "put") {
          return async (input: Parameters<ObjectStorageProvider["put"]>[0]) => {
            if (input.ref.namespace !== "artifact-worker-results") {
              return target.put(input);
            }
            capturedPut = input;
            lateReached();
            return lateCommit;
          };
        }
        // SAFETY: the proxy delegates the original provider property unchanged;
        // only the exact `put` method above is intercepted by this test.
        const value = target[property as keyof typeof target];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as ObjectStorageProvider;
    const lateHandler = new ArtifactSandboxJobHandler({
      kind: "artifact.compose-thumbnail",
      provider,
      profile,
      hostPolicyDigest,
      maxEvidenceAgeMs: 300_000,
      storage: lateStorage,
    });
    const lateController = new AbortController();
    const lateRun = lateHandler.execute({
      job,
      grantedResources: [manifest.object, source.object],
      signal: lateController.signal,
      progress: async () => undefined,
    });
    await atLateStore;
    lateController.abort(new Error("cancel-late-store"));
    await expect(lateRun).rejects.toThrow("cancel-late-store");
    const pending = capturedPut!;
    const lateBytes =
      pending.expectedDigest === previewDigest ? previewBytes : resultBytes;
    resolveLate(
      await storage.put({
        ...pending,
        body: byteStream(lateBytes),
        idempotencyKey: `late-${pending.idempotencyKey}`,
      }),
    );
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await artifactResultCount(storage, "owner-a")) === 0) break;
      await Bun.sleep(2);
    }
    expect(await artifactResultCount(storage, "owner-a")).toBe(0);
  });

  test("binds online manifests to the exact attested egress digest", async () => {
    const config = defaultDevZeroConfig();
    const imageDigest = `sha256:${"f".repeat(64)}` as const;
    const egress = {
      mode: "allowlist" as const,
      destinations: [
        {
          protocol: "https" as const,
          hostname: "school.example",
          port: 443,
          pathPrefix: "/courses",
        },
      ],
      maxRequests: 20,
      maxResponseBytes: 1024 * 1024,
    };
    config.sandbox = {
      ...config.sandbox,
      enabled: true,
      provider: "opensandbox",
      endpoint: "http://opensandbox:8080",
      evidenceEndpoint: "https://attestor.example/evidence",
      hostPolicyDigest,
      isolation: "gvisor",
      images: [
        {
          profileId: "browser",
          image: `ghcr.io/avermate/browser@${imageDigest}`,
          digest: imageDigest,
          architecture: "amd64",
          egress,
        },
      ],
    };
    const profile = configuredArtifactSandboxProfiles(config)[0]!;
    const storage = await filesystemStorage();
    const provider = evidenceProvider(profile);
    const handler = new ArtifactSandboxJobHandler({
      kind: "artifact.browser-render",
      provider,
      profile,
      hostPolicyDigest,
      maxEvidenceAgeMs: 300_000,
      storage,
    });
    const manifest = await store(
      storage,
      "owner-a",
      "sandbox-inputs",
      "browser-request.json",
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          worker: "browser-capture.v1",
          execution: { threadId: "thread-a", branchId: "branch-a" },
          manifest: {
            schemaVersion: 1,
            worker: "browser-capture.v1",
            request: {
              schemaVersion: 1,
              url: "https://school.example/courses/math",
              wait: { kind: "dom-settled", maxMs: 1_000 },
              maxNavigations: 2,
              maxRequests: 10,
              maxResponseBytes: 500_000,
              capture: ["readable-html"],
            },
            egressPolicyDigest: `sha256:${"0".repeat(64)}`,
          },
          inputs: [],
        }),
      ),
      "application/json",
    );
    await expect(
      handler.execute({
        job: artifactJob(
          manifest,
          manifest.byteSize,
          handler.executionProfile(),
        ),
        grantedResources: [manifest.object],
        signal: new AbortController().signal,
        progress: async () => undefined,
      }),
    ).rejects.toThrow("ARTIFACT_WORKER_EGRESS_POLICY_MISMATCH");
    expect(canonicalDigest(egress)).toMatch(/^sha256:/u);
  });
});

async function filesystemStorage() {
  const root = await mkdtemp(join(tmpdir(), "avermate-artifact-worker-"));
  roots.push(root);
  const storage = new FilesystemObjectStorageProvider({
    root: join(root, "objects"),
    maxObjectBytes: 1024 * 1024 * 1024,
    quotaBytes: 2 * 1024 * 1024 * 1024,
  });
  await storage.initialize();
  return storage;
}

async function store(
  storage: FilesystemObjectStorageProvider,
  ownerId: string,
  namespace: string,
  key: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<NodeArtifactRef> {
  const digest = sha256(bytes);
  const commit = await storage.put({
    ref: { ownerId, namespace, key },
    body: byteStream(bytes),
    byteSize: bytes.byteLength,
    mimeType,
    expectedDigest: digest,
    idempotencyKey: `put-${namespace}-${key}`,
  });
  return {
    object: commit.ref,
    digest: commit.digest,
    byteSize: commit.byteSize,
    mimeType: commit.mimeType,
  };
}

function artifactJob(
  manifest: NodeArtifactRef,
  inputBytes: number,
  executionProfile: ReturnType<ArtifactSandboxJobHandler["executionProfile"]>,
) {
  return {
    id: "job-artifact-a",
    principalRef: {
      userId: "owner-a",
      nodeId: "node-a",
      actorKind: "system",
    },
    kind: executionProfile.kind.replace(/@1$/u, ""),
    capabilityVersion: 1,
    executionProfile,
    inputRefs: [manifest],
    resourceRefs: [manifest.object],
    policyRef: `sha256:${"1".repeat(64)}`,
    limits: {
      cpuMillis: 10_000,
      memoryBytes: 512 * 1024 * 1024,
      inputBytes,
      outputBytes: 16 * 1024 * 1024,
      deadline: new Date(Date.now() + 60_000).toISOString(),
    },
    idempotencyKey: "artifact-job-a",
  } as unknown as NodeJobV1;
}

function evidenceProvider(
  profileOrProfiles:
    SandboxExecutionProfile | readonly SandboxExecutionProfile[],
  outputs: Readonly<
    Record<
      string,
      {
        bytes: Uint8Array;
        kind: SandboxFileManifestEntry["kind"];
        mimeType: string;
      }
    >
  > = {},
) {
  const profiles = Array.isArray(profileOrProfiles)
    ? profileOrProfiles
    : [profileOrProfiles];
  const uploaded: SandboxInputFile[] = [];
  const provider = {
    id: "opensandbox" as const,
    async capabilities() {
      return {
        providerId: "opensandbox" as const,
        available: true,
        profiles: [],
      };
    },
    async preflight(input: { profile: SandboxExecutionProfile }) {
      return {
        ok: true as const,
        evidence: {
          baselineVersion: 1 as const,
          providerId: "opensandbox" as const,
          profileId: input.profile.id,
          profileVersion: input.profile.version,
          isolationClass: "gvisor-personal" as const,
          runtimeKind: "opensandbox",
          runtimeVersion: "0.1.11",
          probeVersion: "test",
          imageDigest: input.profile.image.imageDigest,
          hostPolicyDigest,
          evidenceNonce: `evidence-${input.profile.id}`,
          checkedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          checks: baselineChecks(),
        },
      };
    },
    async create(input: {
      profile: SandboxExecutionProfile;
      ownerId: string;
      threadId: string;
      branchId: string;
      expiresAt: Date;
    }) {
      if (!profiles.some((profile) => profile.id === input.profile.id)) {
        throw new Error("TEST_PROFILE_UNAVAILABLE");
      }
      return {
        providerId: "opensandbox" as const,
        sandboxId: "sandbox-a",
        ownerId: input.ownerId,
        threadId: input.threadId,
        branchId: input.branchId,
        profileId: input.profile.id,
        profileVersion: input.profile.version,
        image: input.profile.image,
        evidenceNonce: `evidence-${input.profile.id}`,
        expiresAt: input.expiresAt.toISOString(),
      };
    },
    async putFiles(_handle: unknown, files: readonly SandboxInputFile[]) {
      uploaded.push(...files);
    },
    async *execute() {
      yield {
        type: "started" as const,
        at: new Date().toISOString(),
        pid: null,
      };
      yield {
        type: "exited" as const,
        at: new Date().toISOString(),
        exitCode: 0,
        signal: null,
        outputBytes: Object.values(outputs).reduce(
          (total, output) => total + output.bytes.byteLength,
          0,
        ),
      };
    },
    async getFiles(_handle: unknown, paths: readonly string[]) {
      return paths.map((path) => {
        const output = outputs[path];
        if (!output) throw new Error("TEST_OUTPUT_MISSING");
        return {
          relativePath: path,
          nodeType: "file" as const,
          kind: output.kind,
          mimeType: output.mimeType,
          byteSize: output.bytes.byteLength,
          digest: sha256(output.bytes),
        };
      });
    },
    async *readFile(_handle: unknown, path: string) {
      const output = outputs[path];
      if (!output) throw new Error("TEST_OUTPUT_MISSING");
      yield output.bytes;
    },
    async snapshotWorkspace() {
      throw new Error("TEST_NOT_IMPLEMENTED");
    },
    async forkWorkspace() {
      throw new Error("TEST_NOT_IMPLEMENTED");
    },
    async stop() {},
    async destroy() {},
    uploadedPaths() {
      return uploaded.map((file) => file.relativePath);
    },
  } as unknown as SandboxProvider & { uploadedPaths(): string[] };
  return provider;
}

function baselineChecks() {
  return Object.fromEntries(
    [
      "non-root-unprivileged",
      "readonly-rootfs",
      "capabilities-dropped",
      "no-new-privileges",
      "host-namespaces-isolated",
      "host-mounts-sockets-devices-denied",
      "proc-sys-masked",
      "bounded-tmpfs",
      "seccomp-lsm-enforced",
      "cgroup-limits-enforced",
      "network-default-deny",
      "environment-sanitized",
    ].map((id) => [id, { status: "pass" as const, observed: "verified" }]),
  );
}

function byteStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function sha256(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function storageBoundary(
  storage: FilesystemObjectStorageProvider,
  boundary: "stat" | "get" | "getFiles" | "readFile" | "put",
  reached: () => void,
  blocked: Promise<never>,
) {
  return new Proxy(storage, {
    get(target, property) {
      if (property === boundary && ["stat", "get"].includes(boundary)) {
        return async () => {
          reached();
          return blocked;
        };
      }
      if (property === "put" && boundary === "put") {
        return async (input: Parameters<ObjectStorageProvider["put"]>[0]) => {
          if (input.ref.namespace !== "artifact-worker-results") {
            return target.put(input);
          }
          reached();
          return blocked;
        };
      }
      // SAFETY: the proxy delegates every provider property except the exact
      // boundary selected by this test.
      const value = target[property as keyof typeof target];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as ObjectStorageProvider;
}

function providerBoundary(
  provider: SandboxProvider,
  boundary: "stat" | "get" | "getFiles" | "readFile" | "put",
  reached: () => void,
  blocked: Promise<never>,
) {
  return new Proxy(provider, {
    get(target, property) {
      if (property === "getFiles" && boundary === "getFiles") {
        return async () => {
          reached();
          return blocked;
        };
      }
      if (property === "readFile" && boundary === "readFile") {
        return () => ({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                reached();
                return blocked;
              },
              async return() {
                return { done: true as const, value: undefined };
              },
            };
          },
        });
      }
      // SAFETY: the proxy delegates every provider property except the exact
      // boundary selected by this test.
      const value = target[property as keyof typeof target];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as SandboxProvider;
}

async function artifactResultCount(
  storage: FilesystemObjectStorageProvider,
  ownerId: string,
) {
  let count = 0;
  for await (const _entry of storage.reconcile({
    ownerId,
    namespace: "artifact-worker-results",
    limit: 250,
  }))
    count += 1;
  return count;
}
