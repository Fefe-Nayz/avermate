import { describe, expect, test } from "bun:test";
import {
  configRevision,
  defaultDevZeroConfig,
  loadNodeConfig,
  nodeConfigSchema,
  serializeNodeConfig,
} from "./config";
import { parse } from "yaml";
import { fileURLToPath } from "node:url";

describe("node config", () => {
  test("dev-zero is bootable without Garage or a model provider", () => {
    const config = defaultDevZeroConfig("/tmp/node");
    expect(config.storage.driver).toBe("filesystem");
    expect(config.models.enabled).toBe(false);
    expect(config.sandbox.provider).toBe("disabled");
    expect(nodeConfigSchema.parse(parse(serializeNodeConfig(config)))).toEqual(
      config,
    );
  });

  test("rejects public configurator binds and incomplete storage profiles", () => {
    const base = defaultDevZeroConfig();
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        bind: { host: "0.0.0.0", port: 5_188 },
      }).success,
    ).toBe(false);
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        profile: "node-storage",
        storage: { ...base.storage, driver: "s3", filesystemRoot: undefined },
      }).success,
    ).toBe(false);
    expect(
      nodeConfigSchema.safeParse({
        ...base,
        relay: { coreUrl: "https://core.example" },
      }).success,
    ).toBe(false);
  });

  test("config revisions are stable", () => {
    const config = defaultDevZeroConfig();
    expect(configRevision(config)).toBe(
      configRevision(structuredClone(config)),
    );
  });

  test("all checked-in profile manifests pass the runtime schema", async () => {
    const directory = new URL("../../../infra/node/profiles/", import.meta.url);
    const directoryPath = fileURLToPath(directory);
    const profiles: string[] = [];
    for await (const name of new Bun.Glob("*.yaml").scan({
      cwd: directoryPath,
      onlyFiles: true,
    })) {
      profiles.push(
        (await loadNodeConfig(fileURLToPath(new URL(name, directory)))).profile,
      );
    }
    expect(profiles.sort()).toEqual([
      "full-self-host",
      "node-creator",
      "node-lite",
      "node-local-gpu",
      "node-observable",
      "node-storage",
    ]);
  });
});
