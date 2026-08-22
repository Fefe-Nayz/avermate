import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDevZeroConfig, nodeConfigSchema, serializeNodeConfig } from "./config";
import { loadOrCreateNodeIdentity } from "./identity";
import {
  createNodeBackup,
  planNodeBackup,
  restoreNodeBackup,
  verifyNodeBackup,
  verifyNodeRestore,
} from "./lifecycle";

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "avermate-node-lifecycle-"));
  roots.push(root);
  const dataDir = join(root, "source-data");
  const backupDir = join(dataDir, "backups");
  const configPath = join(root, "node.yaml");
  await mkdir(join(dataDir, "conversations"), { recursive: true });
  await writeFile(join(dataDir, "conversations", "events.json"), "fixture\n");
  const identity = await loadOrCreateNodeIdentity(
    join(dataDir, "secrets", "identity.json"),
  );
  const config = nodeConfigSchema.parse({
    ...defaultDevZeroConfig(dataDir),
    dataDir,
    storage: {
      ...defaultDevZeroConfig(dataDir).storage,
      filesystemRoot: join(dataDir, "objects"),
    },
    lifecycle: {
      backupDir,
      releaseVersion: "1.2.0",
      offline: false,
    },
  });
  await writeFile(configPath, serializeNodeConfig(config));
  const key = crypto.getRandomValues(new Uint8Array(32));
  const archivePath = join(root, "outside", "backup.avnb");
  return { root, dataDir, configPath, config, key, archivePath, identity };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Node encrypted backup lifecycle", () => {
  test("plans, creates, authenticates and restores the exact Node data set", async () => {
    const input = await fixture();
    const plan = await planNodeBackup(input);
    expect(plan.nodeId).toBe(input.identity.nodeId);
    expect(plan.files.map((file) => file.path)).toEqual([
      "conversations/events.json",
      "secrets/identity.json",
    ]);

    const created = await createNodeBackup({ ...input, outputPath: input.archivePath });
    expect(created.fileCount).toBe(2);
    await expect(
      verifyNodeBackup({ archivePath: input.archivePath, key: input.key }),
    ).resolves.toMatchObject({ valid: true, nodeId: input.identity.nodeId });

    const targetDataDir = join(input.root, "restored-data");
    const targetConfigPath = join(input.root, "restored-node.yaml");
    await restoreNodeBackup({
      archivePath: input.archivePath,
      key: input.key,
      targetDataDir,
      targetConfigPath,
    });
    await expect(
      verifyNodeRestore({
        archivePath: input.archivePath,
        key: input.key,
        targetDataDir,
        targetConfigPath,
      }),
    ).resolves.toMatchObject({
      valid: true,
      nodeId: input.identity.nodeId,
      fileCount: 2,
    });
    expect(
      await readFile(join(targetDataDir, "conversations", "events.json"), "utf8"),
    ).toBe("fixture\n");
  });

  test("rejects archive tampering and a non-empty restore target", async () => {
    const input = await fixture();
    await createNodeBackup({ ...input, outputPath: input.archivePath });
    const archive = await readFile(input.archivePath);
    archive[Math.floor(archive.length / 2)] ^= 1;
    await writeFile(input.archivePath, archive);
    await expect(
      verifyNodeBackup({ archivePath: input.archivePath, key: input.key }),
    ).rejects.toThrow();

    const clean = await fixture();
    await createNodeBackup({ ...clean, outputPath: clean.archivePath });
    const targetDataDir = join(clean.root, "non-empty");
    await mkdir(targetDataDir);
    await writeFile(join(targetDataDir, "keep.txt"), "keep");
    await expect(
      restoreNodeBackup({
        archivePath: clean.archivePath,
        key: clean.key,
        targetDataDir,
        targetConfigPath: join(clean.root, "target.yaml"),
      }),
    ).rejects.toThrow("RESTORE_TARGET_NOT_EMPTY");
  });
});
