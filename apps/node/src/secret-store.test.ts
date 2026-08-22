import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeSecretStore } from "./secret-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("NodeSecretStore", () => {
  test("stores owner-only values and returns only an opaque config reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-secrets-"));
    roots.push(root);
    const store = new NodeSecretStore(root);
    const reference = await store.put("relay-primary", "super-secret-value");
    expect(reference).toBe("secret:relay-primary");
    expect(await store.read(reference)).toBe("super-secret-value");
    expect(await readFile(join(root, "relay-primary.secret"), "utf8")).toBe(
      "super-secret-value\n",
    );
    if (process.platform !== "win32") {
      expect((await stat(join(root, "relay-primary.secret"))).mode & 0o077).toBe(
        0,
      );
    }
  });

  test("rejects traversal, arbitrary URI schemes and empty values", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-secrets-"));
    roots.push(root);
    const store = new NodeSecretStore(root);
    await expect(store.put("../escape", "value")).rejects.toThrow(
      "NODE_SECRET_NAME_INVALID",
    );
    await expect(store.put("empty", "   ")).rejects.toThrow(
      "NODE_SECRET_VALUE_INVALID",
    );
    await expect(store.read("https://example.test/secret")).rejects.toThrow();
  });
});
