import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDevZeroConfig } from "./config";
import { FilesystemObjectStorageProvider } from "./filesystem-storage";
import { createConfiguredNodeSandboxProvider } from "./opensandbox-runtime";
import { NodeSecretStore } from "./secret-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("configured Node OpenSandbox runtime", () => {
  test("constructs the production SDK provider from immutable worker config", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-opensandbox-"));
    roots.push(root);
    const storage = new FilesystemObjectStorageProvider({
      root: join(root, "objects"),
      maxObjectBytes: 16 * 1024 * 1024,
      quotaBytes: 64 * 1024 * 1024,
    });
    await storage.initialize();
    const config = defaultDevZeroConfig(join(root, "data"));
    const digest = `sha256:${"a".repeat(64)}` as const;
    config.sandbox = {
      enabled: true,
      provider: "opensandbox",
      endpoint: "http://opensandbox:8080",
      evidenceEndpoint: "https://attestor.example/evidence",
      isolation: "gvisor",
      runtimeCheckpoints: false,
      hostPolicyDigest: `sha256:${"b".repeat(64)}`,
      maxEvidenceAgeSeconds: 300,
      images: [
        {
          profileId: "opencode",
          image: `ghcr.io/reviewed/opencode:1.18.17@${digest}`,
          digest,
          architecture: "amd64",
          egress: { mode: "none" },
        },
      ],
    };
    config.workers.opencode = {
      enabled: true,
      image: config.sandbox.images[0]!.image,
      digest,
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
    const provider = await createConfiguredNodeSandboxProvider({
      config,
      storage,
      secrets: new NodeSecretStore(join(root, "secrets")),
    });
    expect(provider?.id).toBe("opensandbox");
  });

  test("refuses to pretend an unimplemented provider can run specialists", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-opensandbox-"));
    roots.push(root);
    const storage = new FilesystemObjectStorageProvider({
      root: join(root, "objects"),
      maxObjectBytes: 1024 * 1024,
      quotaBytes: 4 * 1024 * 1024,
    });
    await storage.initialize();
    const config = defaultDevZeroConfig(join(root, "data"));
    config.sandbox = {
      ...config.sandbox,
      enabled: true,
      provider: "microsandbox",
      runtimeCheckpoints: true,
    };
    await expect(
      createConfiguredNodeSandboxProvider({
        config,
        storage,
        secrets: new NodeSecretStore(join(root, "secrets")),
      }),
    ).rejects.toThrow("NODE_SANDBOX_PROVIDER_NOT_IMPLEMENTED");
  });
});
