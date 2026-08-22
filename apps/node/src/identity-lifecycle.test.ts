import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultDevZeroConfig,
  nodeConfigSchema,
  serializeNodeConfig,
} from "./config";
import { loadOrCreateNodeIdentity } from "./identity";
import { rotateNodeIdentity } from "./identity-lifecycle";
import { identityFingerprint } from "./protocol";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("confirmed Node identity rotation", () => {
  test("requires exact visible identity confirmation and a verified backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-identity-"));
    roots.push(root);
    const dataDir = join(root, "data");
    const configPath = join(root, "node.yaml");
    await mkdir(join(dataDir, "conversations"), { recursive: true });
    await writeFile(join(dataDir, "conversations", "events.json"), "fixture\n");
    const config = nodeConfigSchema.parse({
      ...defaultDevZeroConfig(dataDir),
      dataDir,
      storage: {
        ...defaultDevZeroConfig(dataDir).storage,
        filesystemRoot: join(dataDir, "objects"),
      },
      lifecycle: {
        backupDir: join(root, "backups"),
        releaseVersion: "1.2.0",
        offline: false,
      },
    });
    await writeFile(configPath, serializeNodeConfig(config));
    const current = await loadOrCreateNodeIdentity(
      join(dataDir, "secrets", "identity.json"),
    );
    const fingerprint = identityFingerprint(current.publicKeyDer);
    const key = crypto.getRandomValues(new Uint8Array(32));
    const backupPath = join(root, "backups", "identity-rotation.avnb");

    await expect(
      rotateNodeIdentity({
        config,
        configPath,
        confirmNodeId: current.nodeId,
        confirmFingerprint: "WRONG",
        backupPath,
        backupKey: key,
      }),
    ).rejects.toThrow("IDENTITY_ROTATION_CONFIRMATION_MISMATCH");

    const result = await rotateNodeIdentity({
      config,
      configPath,
      confirmNodeId: current.nodeId,
      confirmFingerprint: fingerprint,
      backupPath,
      backupKey: key,
      now: new Date("2026-08-22T12:00:00.000Z"),
    });
    expect(result).toMatchObject({
      rotated: true,
      previousNodeId: current.nodeId,
      previousFingerprint: fingerprint,
      restartRequired: true,
      coreRepairRequired: true,
    });
    expect(result.nodeId).not.toBe(current.nodeId);
    expect(result.fingerprint).not.toBe(fingerprint);
  });
});
