import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultDevZeroConfig } from "./config";
import { createNodeDaemon } from "./daemon";
import { bytesStream, digestBytes } from "./filesystem-storage";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("node daemon health", () => {
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
    expect(body.capabilityLimitations.jobs).toBe("executor-not-implemented");
    expect(body.capabilityLimitations.conversations).toBe(
      "provider-not-activated",
    );
    expect(body.capabilityLimitations.retrieval).toBe(
      "lexical-provider-not-activated",
    );
    expect(body.capabilityLimitations.models).toBe("not-configured");
    expect(body.capabilityLimitations.sandbox).toBe("disabled");

    const rebound = await daemon.fetch(
      new Request("http://attacker.invalid/health", {
        headers: { host: "attacker.invalid" },
      }),
    );
    expect(rebound.status).toBe(400);
  });
});
