import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalJson } from "./canonical-json";
import { defaultDevZeroConfig, nodeConfigSchema } from "./config";
import {
  buildReleaseBundle,
  importReleaseBundle,
  planNodeUpgrade,
  releaseManifestSchema,
  verifyReleaseBundle,
} from "./release-lifecycle";

const roots: string[] = [];

function digest(body: Uint8Array | string) {
  return `sha256:${createHash("sha256").update(body).digest("hex")}` as const;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "avermate-node-release-"));
  roots.push(root);
  const bundleDir = join(root, "bundle");
  await mkdir(bundleDir);
  const bodies = new Map<string, string>([
    ["images/web.oci", "web-image"],
    ["images/core.oci", "core-image"],
    ["images/node.oci", "node-image"],
    ["images/cosign.bundle", "cosign-bundle"],
    ["sbom/release.spdx.json", "{}"],
    ["migrations/0060_fixture.sql", "SELECT 1;"],
    ["provenance.intoto.jsonl", "{}\n"],
    ["THIRD_PARTY_NOTICES.txt", "fixture notices\n"],
    ["verify.ts", "console.log('verify')\n"],
  ]);
  for (const [path, body] of bodies) {
    const target = join(bundleDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  const files = [...bodies].map(([path, body]) => ({
    path,
    digest: digest(body),
    byteSize: Buffer.byteLength(body),
    mode: 0o600,
  }));
  const manifest = releaseManifestSchema.parse({
    schemaVersion: 1,
    product: "avermate-full-self-host",
    releaseVersion: "1.3.0",
    previousReleaseVersion: "1.2.0",
    createdAt: new Date().toISOString(),
    components: ["web", "core", "node", "migrations", "verification"],
    files,
    images: ["web", "core", "node"].map((id) => ({
      id,
      reference: `registry.example/avermate-${id}@sha256:${"a".repeat(64)}`,
      archivePath: `images/${id}.oci`,
      cosignBundlePath: "images/cosign.bundle",
      sbomPath: "sbom/release.spdx.json",
    })),
    models: [],
    migrations: [
      {
        id: "0060_fixture",
        path: "migrations/0060_fixture.sql",
        digest: digest(bodies.get("migrations/0060_fixture.sql")!),
      },
    ],
    provenancePath: "provenance.intoto.jsonl",
    noticesPath: "THIRD_PARTY_NOTICES.txt",
    verificationEntrypoint: "verify.ts",
    airgap: {
      externalDestinations: [],
      registryPullsAfterImport: false,
      telemetry: false,
      managedServices: false,
      hostedCore: false,
    },
  });
  const keys = generateKeyPairSync("ed25519");
  const publicKeyPath = join(root, "release-public.pem");
  const privateKeyPath = join(root, "release-private.pem");
  await writeFile(
    publicKeyPath,
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  await writeFile(
    privateKeyPath,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  const signed = {
    manifest,
    keyId: "release-fixture",
    algorithm: "ed25519" as const,
    signature: sign(
      null,
      Buffer.from(canonicalJson(manifest)),
      keys.privateKey,
    ).toString("base64url"),
  };
  await writeFile(
    join(bundleDir, "release-manifest.json"),
    `${JSON.stringify(signed, null, 2)}\n`,
  );
  return { root, bundleDir, publicKeyPath, privateKeyPath, manifest };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("signed offline release lifecycle", () => {
  test("assembles an offline bundle with generated SPDX and provenance before signing", async () => {
    const input = await fixture();
    const staging = join(input.root, "staging");
    const outputDir = join(input.root, "assembled");
    await mkdir(staging);
    for (const file of input.manifest.files) {
      if (
        file.path === input.manifest.provenancePath ||
        file.path === "sbom/release.spdx.json"
      ) {
        continue;
      }
      const target = join(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await Bun.file(join(input.bundleDir, file.path)).bytes());
    }
    const built = await buildReleaseBundle({
      sourceDir: staging,
      outputDir,
      privateKeyPath: input.privateKeyPath,
      now: new Date("2026-08-22T12:00:00.000Z"),
      metadata: {
        releaseVersion: "1.3.0",
        previousReleaseVersion: "1.2.0",
        keyId: "release-fixture",
        noticesPath: "THIRD_PARTY_NOTICES.txt",
        verificationEntrypoint: "verify.ts",
        images: input.manifest.images.map(({ sbomPath: _sbomPath, ...image }) => image),
        models: [],
        migrations: input.manifest.migrations.map(({ digest: _digest, ...migration }) => migration),
      },
    });
    expect(built).toMatchObject({ built: true, releaseVersion: "1.3.0" });
    await expect(
      verifyReleaseBundle({
        bundleDir: outputDir,
        publicKeyPath: input.publicKeyPath,
      }),
    ).resolves.toMatchObject({ valid: true, releaseVersion: "1.3.0" });
    const sbom = await Bun.file(join(outputDir, "sbom/release.spdx.json")).json();
    expect(sbom.spdxVersion).toBe("SPDX-2.3");
    expect(sbom.packages).toHaveLength(3);
    const provenance = await Bun.file(
      join(outputDir, "provenance/release.intoto.jsonl"),
    ).text();
    expect(provenance).toContain("https://slsa.dev/provenance/v1");
  });

  test("verifies every signed file and imports only into an empty target", async () => {
    const input = await fixture();
    await expect(verifyReleaseBundle(input)).resolves.toMatchObject({
      valid: true,
      releaseVersion: "1.3.0",
      staticVerified: true,
      liveAirgapProven: false,
    });
    const targetDir = join(input.root, "imported");
    await expect(
      importReleaseBundle({ ...input, targetDir }),
    ).resolves.toMatchObject({ imported: true, targetDir });
    await expect(
      importReleaseBundle({ ...input, targetDir }),
    ).rejects.toThrow("BUNDLE_IMPORT_TARGET_NOT_EMPTY");
  });

  test("enforces exact N-1 and fails a mutated bundle", async () => {
    const input = await fixture();
    const config = nodeConfigSchema.parse({
      ...defaultDevZeroConfig(join(input.root, "data")),
      lifecycle: {
        backupDir: join(input.root, "backups"),
        releaseVersion: "1.2.0",
        offline: false,
      },
    });
    await expect(planNodeUpgrade({ ...input, config })).resolves.toMatchObject({
      currentReleaseVersion: "1.2.0",
      targetReleaseVersion: "1.3.0",
      backupRequired: true,
    });
    await expect(
      planNodeUpgrade({
        ...input,
        config: nodeConfigSchema.parse({
          ...config,
          lifecycle: { ...config.lifecycle, releaseVersion: "1.1.0" },
        }),
      }),
    ).rejects.toThrow("UPGRADE_ONLY_EXACT_N_MINUS_ONE_SUPPORTED");
    await writeFile(join(input.bundleDir, "images/node.oci"), "mutated");
    await expect(verifyReleaseBundle(input)).rejects.toThrow(
      "BUNDLE_FILE_DIGEST_MISMATCH",
    );
  });
});
