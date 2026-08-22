import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemObjectStorageProvider } from "./filesystem-storage";
import { NodePortableWorkspaceSnapshotStore } from "./portable-workspace-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Node portable workspace snapshots", () => {
  test("round-trips content-addressed files and fences owners", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-workspace-"));
    roots.push(root);
    const storage = new FilesystemObjectStorageProvider({
      root,
      maxObjectBytes: 16 * 1024 * 1024,
      quotaBytes: 64 * 1024 * 1024,
    });
    await storage.initialize();
    const snapshots = new NodePortableWorkspaceSnapshotStore(storage);
    const source = [
      {
        relativePath: "src/main.ts",
        bytes: new TextEncoder().encode("export const answer = 42;\n"),
        mode: 0o600,
      },
      {
        relativePath: "input/request.json",
        bytes: new TextEncoder().encode('{"kind":"lesson"}\n'),
        mode: 0o400,
      },
    ];
    const ref = await snapshots.capture({
      provider: "opensandbox",
      ownerId: "owner-a",
      files: source,
    });
    const restored = await snapshots.restore({
      ref,
      ownerId: "owner-a",
      maximumBytes: 1024 * 1024,
      maximumFiles: 10,
    });
    expect(
      restored.map((file) => [
        file.relativePath,
        new TextDecoder().decode(file.bytes),
        file.mode,
      ]),
    ).toEqual([
      ["input/request.json", '{"kind":"lesson"}\n', 0o400],
      ["src/main.ts", "export const answer = 42;\n", 0o600],
    ]);
    await expect(
      snapshots.restore({
        ref,
        ownerId: "owner-b",
        maximumBytes: 1024 * 1024,
        maximumFiles: 10,
      }),
    ).rejects.toThrow();
  });

  test("rejects normalized path collisions before storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-workspace-"));
    roots.push(root);
    const storage = new FilesystemObjectStorageProvider({
      root,
      maxObjectBytes: 1024 * 1024,
      quotaBytes: 4 * 1024 * 1024,
    });
    await storage.initialize();
    const snapshots = new NodePortableWorkspaceSnapshotStore(storage);
    await expect(
      snapshots.capture({
        provider: "opensandbox",
        ownerId: "owner-a",
        files: [
          { relativePath: "src/A.ts", bytes: new Uint8Array([1]) },
          { relativePath: "src/a.ts", bytes: new Uint8Array([2]) },
        ],
      }),
    ).rejects.toThrow("PORTABLE_WORKSPACE_PATH_DUPLICATE");
  });
});
