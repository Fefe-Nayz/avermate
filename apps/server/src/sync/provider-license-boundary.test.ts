import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const serverRoot = join(import.meta.dir, "../..");

describe("school provider release license boundary", () => {
  test("keeps GPL adapters out of runtime dependencies and the active registry", () => {
    const manifest = JSON.parse(
      readFileSync(join(serverRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const providerRegistry = readFileSync(
      join(import.meta.dir, "provider.ts"),
      "utf8",
    );

    expect(manifest.dependencies?.pawnote).toBeUndefined();
    expect(manifest.dependencies?.["scolengo-api"]).toBeUndefined();
    expect(manifest.devDependencies?.pawnote).toBe("1.6.2");
    expect(manifest.devDependencies?.["scolengo-api"]).toBe("3.0.5");
    expect(providerRegistry).not.toContain('from "./pronote"');
    expect(providerRegistry).not.toContain('from "./skolengo"');
    expect(providerRegistry).toContain(
      'importDevelopmentProvider("./pronote")',
    );
    expect(providerRegistry).toContain(
      'importDevelopmentProvider("./skolengo")',
    );
    expect(providerRegistry).toContain("developmentSchoolProvidersEnabled()");
  });

  test("installs only production dependencies in the release image", () => {
    const dockerfile = readFileSync(join(serverRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toContain(
      "RUN bun install --frozen-lockfile --production",
    );
    expect(dockerfile).toContain("COPY patches patches");
    expect(dockerfile).toContain(
      "COPY --from=deps /app/apps/server/node_modules apps/server/node_modules",
    );
    expect(dockerfile).not.toMatch(
      /RUN bun install --frozen-lockfile\s*(?:\r?\n|$)/,
    );
  });

  test("does not evaluate GPL provider loaders in the production registry", async () => {
    const { createSyncProviderRegistry } = await import("./provider");
    let loaderCalls = 0;
    const rejectLoad = async () => {
      loaderCalls += 1;
      throw new Error("development dependency was loaded");
    };
    const registry = await createSyncProviderRegistry({
      enableDevelopmentProviders: false,
      loaders: {
        pronote: rejectLoad,
        skolengo: rejectLoad,
      },
    });
    expect(loaderCalls).toBe(0);
    expect(Object.keys(registry).sort()).toEqual(["ecoledirecte", "moodle"]);

    // A fresh process is required here: another test file may already have
    // imported the module under NODE_ENV=test, and ESM caches are process-wide.
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        'const { SYNC_PROVIDERS } = await import("./src/sync/provider.ts"); console.log(JSON.stringify(Object.keys(SYNC_PROVIDERS).sort()))',
      ],
      {
        cwd: serverRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: "file::memory:",
          BETTER_AUTH_URL: "http://localhost:3000",
          BETTER_AUTH_SECRET:
            "provider-license-test-secret-at-least-32-characters",
          CLIENT_URL: "http://localhost:3001",
        },
      },
    );
    expect(probe.status).toBe(0);
    expect(probe.stderr).toBe("");
    expect(JSON.parse(probe.stdout.trim())).toEqual(["ecoledirecte", "moodle"]);
  });
});
