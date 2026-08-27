import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defaultDevZeroConfig,
  loadNodeConfig,
  serializeNodeConfig,
} from "./config";
import { createNodeDaemon, startNodeDaemon } from "./daemon";
import { bytesStream, digestBytes } from "./filesystem-storage";
import { createSpecialistSandboxProfile } from "./specialist-workers";
import { configuredArtifactSandboxProfiles } from "./artifact-workers";
import { canonicalDigest } from "./canonical-json";
import type {
  SandboxExecutionProfile,
  SandboxProvider,
} from "@avermate/agent-contracts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("node daemon health", () => {
  test("does not advertise configured retrieval providers as local vector indexes", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "avermate-node-retrieval-manifest-"),
    );
    roots.push(root);
    const config = defaultDevZeroConfig(join(root, "data"));
    config.storage.filesystemRoot = join(root, "objects");
    config.retrieval.embeddingEndpoint = "http://127.0.0.1:8081/v1/embeddings";
    config.retrieval.embeddingProvider = "tei";
    config.retrieval.embeddingModel = "school-embedding";
    config.retrieval.embeddingRevision = "school-embedding-r1";
    config.retrieval.embeddingDimensions = [768];
    config.retrieval.rerankEndpoint = "http://127.0.0.1:8082/v1/rerank";
    config.retrieval.rerankProvider = "qwen3";
    config.retrieval.rerankModel = "school-reranker";
    config.retrieval.rerankRevision = "school-reranker-r1";
    config.retrieval.rerankImageDigest = `sha256:${"a".repeat(64)}`;
    config.retrieval.rerankRuntimeRevision = "qwen3-runtime-r1";

    const daemon = await createNodeDaemon({ config });
    expect((await daemon.manifest()).features.retrieval).toEqual({
      version: 1,
      lexical: true,
      vectorSpaces: [],
      providers: [
        {
          purpose: "embedding",
          provider: "tei",
          model: "school-embedding",
          modelRevision: "school-embedding-r1",
          dimensions: 768,
        },
        {
          purpose: "rerank",
          provider: "qwen3",
          model: "school-reranker",
          modelRevision: "school-reranker-r1",
          imageDigest: `sha256:${"a".repeat(64)}`,
          runtimeRevision: "qwen3-runtime-r1",
        },
      ],
    });
  });

  test("advertises MCP only with the exact reviewed transport limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-mcp-manifest-"));
    roots.push(root);
    const config = defaultDevZeroConfig(join(root, "data"));
    config.storage.filesystemRoot = join(root, "objects");
    config.mcp = {
      enabled: true,
      allowedEndpoints: ["http://mcp.internal/mcp"],
      maxCatalogueTools: 250,
      maxRequestBytes: 8 * 1024,
      maxResponseBytes: 512 * 1024,
      connectTimeoutMs: 2_000,
      operationTimeoutMs: 5_000,
    };
    const daemon = await createNodeDaemon({ config });
    expect((await daemon.manifest()).features.mcp).toEqual({
      version: 1,
      transports: ["streamable-http"],
      maxCatalogueTools: 250,
      maxRequestBytes: 8 * 1024,
      maxResponseBytes: 512 * 1024,
    });
  });

  test("exposes the container bridge only through the canonical loopback Host", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-bridge-"));
    roots.push(root);
    const reservePort = () => {
      const reservation = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response(null, { status: 204 }),
      });
      const port = reservation.port;
      reservation.stop(true);
      if (!port) throw new Error("TEST_PORT_RESERVATION_FAILED");
      return port;
    };
    const mainPort = reservePort();
    const bridgePort = reservePort();
    const config = defaultDevZeroConfig(join(root, "data"));
    config.bind.port = mainPort;
    config.storage.filesystemRoot = join(root, "objects");
    const running = await startNodeDaemon({
      config,
      containerBridgePort: bridgePort,
    });
    try {
      const setup = await fetch(`http://127.0.0.1:${bridgePort}/setup`, {
        headers: { host: `127.0.0.1:${mainPort}` },
      });
      expect(setup.status).toBe(200);
      const wrongHost = await fetch(
        `http://127.0.0.1:${bridgePort}/setup`,
      );
      expect(wrongHost.status).toBe(400);
    } finally {
      await running.stop();
    }
  });

  test("copies an immutable first-boot template once and reloads the mutable config", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-bootstrap-"));
    roots.push(root);
    const templatePath = join(root, "profile.yaml");
    const configPath = join(root, "state", "avermate-node.yaml");
    const template = defaultDevZeroConfig(join(root, "data"));
    template.storage.quotaBytes = 10 * 1024 ** 3;
    await writeFile(templatePath, serializeNodeConfig(template));

    const first = await createNodeDaemon({ configPath, configTemplatePath: templatePath });
    expect(first.config.storage.quotaBytes).toBe(10 * 1024 ** 3);
    expect((await loadNodeConfig(configPath)).storage.quotaBytes).toBe(
      10 * 1024 ** 3,
    );

    const persisted = structuredClone(first.config);
    persisted.storage.quotaBytes = 11 * 1024 ** 3;
    await writeFile(configPath, serializeNodeConfig(persisted), { mode: 0o600 });
    const restarted = await createNodeDaemon({
      configPath,
      configTemplatePath: templatePath,
    });
    expect(restarted.config.storage.quotaBytes).toBe(11 * 1024 ** 3);
    expect((await loadNodeConfig(templatePath)).storage.quotaBytes).toBe(
      10 * 1024 ** 3,
    );
  });

  test("reports observed storage usage and rejects rebinding Host headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-daemon-"));
    roots.push(root);
    const config = defaultDevZeroConfig(join(root, "data"));
    config.storage.filesystemRoot = join(root, "objects");
    const daemon = await createNodeDaemon({ config });
    const bytes = new TextEncoder().encode("observed");
    await daemon.storage.put({
      ref: { ownerId: "user-1", namespace: "files", key: "observed" },
      body: bytesStream(bytes),
      byteSize: bytes.byteLength,
      mimeType: "text/plain",
      expectedDigest: digestBytes(bytes),
      idempotencyKey: "put",
    });
    const health = await daemon.fetch(
      new Request("http://127.0.0.1:5188/health", {
        headers: { host: "127.0.0.1:5188" },
      }),
    );
    const body = (await health.json()) as {
      manifest: {
        features: { storage?: unknown; jobs?: unknown };
        limits: { storageUsedBytes: number };
      };
      capabilityLimitations: {
        jobs?: string;
        conversations?: string;
        retrieval?: string;
        models?: string;
        sandbox?: string;
      };
    };
    expect(health.status).toBe(200);
    expect(body.manifest.limits.storageUsedBytes).toBe(bytes.byteLength);
    expect(body.manifest.features.storage).toBeDefined();
    expect(body.manifest.features.jobs).toBeUndefined();
    expect(body.capabilityLimitations.jobs).toBe("no-reviewed-job-handlers");
    expect(body.capabilityLimitations.conversations).toBeNull();
    expect(body.capabilityLimitations.retrieval).toBeNull();
    expect(body.capabilityLimitations.models).toBe("not-configured");
    expect(body.capabilityLimitations.sandbox).toBe("disabled");

    const rebound = await daemon.fetch(
      new Request("http://attacker.invalid/health", {
        headers: { host: "attacker.invalid" },
      }),
    );
    expect(rebound.status).toBe(400);
  });

  test("advertises specialist jobs only while the injected provider preflight is healthy", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-specialist-"));
    roots.push(root);
    const config = defaultDevZeroConfig(join(root, "data"));
    config.storage.filesystemRoot = join(root, "objects");
    const imageDigest = `sha256:${"a".repeat(64)}` as const;
    const hostPolicyDigest = `sha256:${"b".repeat(64)}` as const;
    config.sandbox = {
      enabled: true,
      provider: "opensandbox",
      endpoint: "http://127.0.0.1:8080",
      evidenceEndpoint: "https://attestor.example/evidence",
      isolation: "gvisor",
      runtimeCheckpoints: false,
      hostPolicyDigest,
      maxEvidenceAgeSeconds: 300,
      images: [
        {
          profileId: "opencode",
          image: `ghcr.io/reviewed/opencode:1.18.17@${imageDigest}`,
          digest: imageDigest,
          architecture: "amd64",
          egress: { mode: "none" },
        },
      ],
    };
    config.workers.opencode = {
      enabled: true,
      image: config.sandbox.images[0]!.image,
      digest: imageDigest,
      license: "MIT",
      maximumInputBytes: 1024 * 1024,
      maximumOutputBytes: 2 * 1024 * 1024,
      maximumCommands: 2,
      commandCatalogue: [
        {
          id: "analyze",
          argv: [
            "/opt/avermate/bin/opencode",
            "run",
            "Read /workspace/input/request.json",
          ],
        },
      ],
      network: "denied",
      allowedHosts: [],
    };
    let healthy = true;
    const specialistProfile = createSpecialistSandboxProfile(
      "opencode",
      config.workers.opencode,
    );
    const provider = {
      id: "opensandbox" as const,
      async capabilities() {
        const result = await provider.preflight({
          profile: specialistProfile,
          expectedHostPolicyDigest: hostPolicyDigest,
          maxEvidenceAgeMs: 300_000,
        });
        return result.ok
          ? {
              providerId: "opensandbox" as const,
              available: true,
              profiles: [
                {
                  id: specialistProfile.id,
                  version: specialistProfile.version,
                  isolationClass: result.evidence.isolationClass,
                  evidence: result.evidence,
                },
              ],
            }
          : {
              providerId: "opensandbox" as const,
              available: false,
              profiles: [],
            };
      },
      async preflight(input: { profile: SandboxExecutionProfile }) {
        if (!healthy) {
          return {
            ok: false as const,
            reason: "TRANSPORT_UNAVAILABLE" as const,
            message: "offline",
          };
        }
        const checks = Object.fromEntries(
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
          ].map((id) => [id, { status: "pass", observed: "verified" }]),
        );
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
            evidenceNonce: "specialist-evidence",
            checkedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            checks,
          },
        };
      },
    } as unknown as SandboxProvider;
    const daemon = await createNodeDaemon({
      config,
      specialistProvider: provider,
    });
    expect((await daemon.manifest()).features.jobs?.kinds).toEqual([
      "specialist.opencode@1",
    ]);
    healthy = false;
    expect((await daemon.manifest()).features.jobs).toBeUndefined();
  });

  test("signs exact execution profile revisions only for healthy artifact jobs", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-artifacts-"));
    roots.push(root);
    const config = defaultDevZeroConfig(join(root, "data"));
    config.storage.filesystemRoot = join(root, "objects");
    const imageDigest = `sha256:${"c".repeat(64)}` as const;
    const hostPolicyDigest = `sha256:${"d".repeat(64)}` as const;
    config.sandbox = {
      ...config.sandbox,
      enabled: true,
      provider: "opensandbox",
      endpoint: "http://127.0.0.1:8080",
      evidenceEndpoint: "https://attestor.example/evidence",
      isolation: "gvisor",
      hostPolicyDigest,
      images: [
        {
          profileId: "media",
          image: `ghcr.io/reviewed/media:v1@${imageDigest}`,
          digest: imageDigest,
          architecture: "amd64",
          egress: { mode: "none" },
        },
      ],
    };
    const profiles = configuredArtifactSandboxProfiles(config);
    const daemon = await createNodeDaemon({
      config,
      specialistProvider: attestedProvider(profiles, hostPolicyDigest),
    });
    const manifest = await daemon.manifest();
    expect(manifest.signature.length).toBeGreaterThan(32);
    expect(manifest.features.jobs?.executionProfiles).toEqual(
      manifest.features.jobs?.kinds.map((kind) => ({
        kind,
        sandboxProfileId: "media",
        profileVersion: profiles[0]!.version,
        imageDigest,
        egressPolicyDigest: canonicalDigest({ mode: "none" }),
      })),
    );
  });
});

function attestedProvider(
  profiles: readonly SandboxExecutionProfile[],
  hostPolicyDigest: `sha256:${string}`,
): SandboxProvider {
  const checks = Object.fromEntries(
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
    ].map((id) => [id, { status: "pass", observed: "verified" }]),
  );
  const evidence = (profile: SandboxExecutionProfile) => ({
    baselineVersion: 1 as const,
    providerId: "opensandbox" as const,
    profileId: profile.id,
    profileVersion: profile.version,
    isolationClass: "gvisor-personal" as const,
    runtimeKind: "opensandbox",
    runtimeVersion: "0.1.11",
    probeVersion: "test",
    imageDigest: profile.image.imageDigest,
    hostPolicyDigest,
    evidenceNonce: `artifact-${profile.id}`,
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    checks,
  });
  return {
    id: "opensandbox" as const,
    async capabilities() {
      return {
        providerId: "opensandbox" as const,
        available: true,
        profiles: profiles.map((profile) => ({
          id: profile.id,
          version: profile.version,
          isolationClass: "gvisor-personal" as const,
          evidence: evidence(profile),
        })),
      };
    },
    async preflight(input: { profile: SandboxExecutionProfile }) {
      return { ok: true as const, evidence: evidence(input.profile) };
    },
  } as unknown as SandboxProvider;
}
