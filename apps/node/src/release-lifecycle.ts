import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, parse as parsePath, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { canonicalJson } from "./canonical-json";
import {
  configRevision,
  nodeConfigSchema,
  serializeNodeConfig,
  type NodeConfig,
} from "./config";
import { createNodeBackup, verifyNodeBackup } from "./lifecycle";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
    "expected a safe portable relative path",
  );
const immutableRevisionSchema = z
  .string()
  .min(7)
  .max(256)
  .refine(
    (value) =>
      !/(?:^|[/:@._-])(latest|main|master|nightly|edge)(?:$|[/:@._-])/iu.test(
        value,
      ),
    "expected an immutable revision",
  );
const imageReferenceSchema = z
  .string()
  .max(1_024)
  .regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/u);

export const releaseManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    product: z.literal("avermate-full-self-host"),
    releaseVersion: z.string().min(1).max(128),
    previousReleaseVersion: z.string().min(1).max(128),
    createdAt: z.string().datetime({ offset: true }),
    components: z
      .array(z.enum(["web", "core", "node", "migrations", "verification"]))
      .length(5),
    files: z
      .array(
        z.strictObject({
          path: relativePathSchema,
          digest: digestSchema,
          byteSize: z.number().int().nonnegative().max(100 * 1024 ** 3),
          mode: z.number().int().min(0).max(0o777).default(0o600),
        }),
      )
      .min(5)
      .max(1_000_000),
    images: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(128),
          reference: imageReferenceSchema,
          archivePath: relativePathSchema,
          cosignBundlePath: relativePathSchema,
          sbomPath: relativePathSchema,
        }),
      )
      .min(3)
      .max(256),
    models: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(256),
          revision: immutableRevisionSchema,
          optional: z.boolean(),
          filePaths: z.array(relativePathSchema).max(100_000),
        }),
      )
      .max(256),
    migrations: z
      .array(
        z.strictObject({
          id: z.string().regex(/^\d{4}_[a-z0-9_]+$/u),
          path: relativePathSchema,
          digest: digestSchema,
        }),
      )
      .min(1)
      .max(10_000),
    provenancePath: relativePathSchema,
    noticesPath: relativePathSchema,
    verificationEntrypoint: relativePathSchema,
    airgap: z.strictObject({
      externalDestinations: z.tuple([]),
      registryPullsAfterImport: z.literal(false),
      telemetry: z.literal(false),
      managedServices: z.literal(false),
      hostedCore: z.literal(false),
    }),
  })
  .superRefine((manifest, context) => {
    const paths = new Set<string>();
    for (const [index, file] of manifest.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "path"],
          message: "bundle paths must be unique",
        });
      }
      paths.add(file.path);
    }
    const requiredPaths = [
      manifest.provenancePath,
      manifest.noticesPath,
      manifest.verificationEntrypoint,
      ...manifest.migrations.map((migration) => migration.path),
      ...manifest.images.flatMap((image) => [
        image.archivePath,
        image.cosignBundlePath,
        image.sbomPath,
      ]),
      ...manifest.models.flatMap((model) => model.filePaths),
    ];
    for (const path of requiredPaths) {
      if (!paths.has(path)) {
        context.addIssue({
          code: "custom",
          path: ["files"],
          message: `manifest metadata references an unlisted file: ${path}`,
        });
      }
    }
    for (const migration of manifest.migrations) {
      const file = manifest.files.find((candidate) => candidate.path === migration.path);
      if (file?.digest !== migration.digest) {
        context.addIssue({
          code: "custom",
          path: ["migrations", migration.id],
          message: "migration digest must match the file inventory",
        });
      }
    }
  });
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const signedReleaseManifestSchema = z.strictObject({
  manifest: releaseManifestSchema,
  keyId: z.string().min(1).max(256),
  algorithm: z.literal("ed25519"),
  signature: z.string().min(32).max(1_024),
});
export type SignedReleaseManifest = z.infer<
  typeof signedReleaseManifestSchema
>;

export const releaseBundleBuildMetadataSchema = z.strictObject({
  releaseVersion: z.string().min(1).max(128),
  previousReleaseVersion: z.string().min(1).max(128),
  keyId: z.string().min(1).max(256),
  noticesPath: relativePathSchema,
  verificationEntrypoint: relativePathSchema,
  images: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        reference: imageReferenceSchema,
        archivePath: relativePathSchema,
        cosignBundlePath: relativePathSchema,
      }),
    )
    .min(3)
    .max(256),
  models: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(256),
        revision: immutableRevisionSchema,
        optional: z.boolean(),
        filePaths: z.array(relativePathSchema).max(100_000),
      }),
    )
    .max(256)
    .default([]),
  migrations: z
    .array(
      z.strictObject({
        id: z.string().regex(/^\d{4}_[a-z0-9_]+$/u),
        path: relativePathSchema,
      }),
    )
    .min(1)
    .max(10_000),
});
export type ReleaseBundleBuildMetadata = z.infer<
  typeof releaseBundleBuildMetadataSchema
>;

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;
}

function within(parent: string, candidate: string) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function assertSafeTarget(path: string) {
  const target = resolve(path);
  if (parsePath(target).root === target) throw new Error("BUNDLE_TARGET_TOO_BROAD");
  return target;
}

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(path: string, body: Uint8Array | string, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, body, { flag: "wx", mode });
  await rename(temporary, path);
  await chmod(path, mode).catch(() => undefined);
}

async function assertEmptyDirectory(path: string) {
  const target = assertSafeTarget(path);
  if (!(await exists(target))) return target;
  const metadata = await lstat(target);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await readdir(target)).length > 0
  ) {
    throw new Error("BUNDLE_IMPORT_TARGET_NOT_EMPTY");
  }
  return target;
}

async function readSignedManifest(bundleDir: string) {
  const path = join(resolve(bundleDir), "release-manifest.json");
  return signedReleaseManifestSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
}

async function verifySignature(
  signed: SignedReleaseManifest,
  publicKeyPath: string,
) {
  const publicKey = createPublicKey(await readFile(resolve(publicKeyPath), "utf8"));
  const valid = verify(
    null,
    Buffer.from(canonicalJson(signed.manifest)),
    publicKey,
    Buffer.from(signed.signature, "base64url"),
  );
  if (!valid) throw new Error("RELEASE_MANIFEST_SIGNATURE_INVALID");
}

async function listMaterialFiles(root: string) {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      if (!within(root, absolute)) throw new Error("BUNDLE_PATH_ESCAPE");
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error("BUNDLE_SYMLINK_DENIED");
      if (metadata.isDirectory()) await visit(absolute);
      else if (metadata.isFile()) {
        files.push(relative(root, absolute).replaceAll("\\", "/"));
      } else throw new Error("BUNDLE_SPECIAL_FILE_DENIED");
    }
  }
  await visit(root);
  return files;
}

async function copyMaterialTree(source: string, target: string) {
  for (const path of await listMaterialFiles(source)) {
    if (path === "release-manifest.json") {
      throw new Error("BUNDLE_SOURCE_MANIFEST_ALREADY_PRESENT");
    }
    const from = resolve(source, path);
    const to = resolve(target, path);
    if (!within(source, from) || !within(target, to)) {
      throw new Error("BUNDLE_PATH_ESCAPE");
    }
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    await copyFile(from, to);
    await chmod(to, 0o600).catch(() => undefined);
  }
}

function spdxDocument(input: {
  releaseVersion: string;
  files: Array<{ path: string; digest: `sha256:${string}` }>;
  images: ReleaseBundleBuildMetadata["images"];
}) {
  const documentId = input.files
    .map((file) => `${file.path}\0${file.digest}`)
    .join("\n");
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `avermate-full-self-host-${input.releaseVersion}`,
    documentNamespace: `https://avermate.local/spdx/${sha256(new TextEncoder().encode(documentId)).slice("sha256:".length)}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ["Tool: avermate-node-bundle-builder-v1"],
    },
    packages: input.images.map((image, index) => ({
      SPDXID: `SPDXRef-Image-${index + 1}`,
      name: image.id,
      versionInfo: image.reference,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:oci/${encodeURIComponent(image.id)}?repository_url=${encodeURIComponent(image.reference)}`,
        },
      ],
    })),
    files: input.files.map((file, index) => ({
      SPDXID: `SPDXRef-File-${index + 1}`,
      fileName: `./${file.path}`,
      checksums: [
        {
          algorithm: "SHA256",
          checksumValue: file.digest.slice("sha256:".length),
        },
      ],
      licenseConcluded: "NOASSERTION",
      copyrightText: "NOASSERTION",
    })),
  };
}

/**
 * Assemble a deterministic, signed offline release from an explicitly staged
 * directory. The staging directory contains OCI archives, cosign bundles,
 * migrations, notices, Web assets/config schema and the offline verifier. The
 * builder never pulls an image/model or invokes Docker; missing materials fail
 * closed before a manifest is signed.
 */
export async function buildReleaseBundle(input: {
  sourceDir: string;
  outputDir: string;
  privateKeyPath: string;
  metadata: ReleaseBundleBuildMetadata;
  now?: Date;
}) {
  const metadata = releaseBundleBuildMetadataSchema.parse(input.metadata);
  const source = assertSafeTarget(input.sourceDir);
  const target = await assertEmptyDirectory(input.outputDir);
  if (within(source, target) || within(target, source)) {
    throw new Error("BUNDLE_SOURCE_TARGET_OVERLAP");
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  await copyMaterialTree(source, target);

  const stagedPaths = new Set(await listMaterialFiles(target));
  const required = [
    metadata.noticesPath,
    metadata.verificationEntrypoint,
    ...metadata.images.flatMap((image) => [
      image.archivePath,
      image.cosignBundlePath,
    ]),
    ...metadata.models.flatMap((model) => model.filePaths),
    ...metadata.migrations.map((migration) => migration.path),
  ];
  const missing = required.filter((path) => !stagedPaths.has(path));
  if (missing.length > 0) {
    throw new Error(`BUNDLE_REQUIRED_MATERIAL_MISSING:${missing.join(",")}`);
  }

  const preSbomFiles = await Promise.all(
    [...stagedPaths].sort().map(async (path) => {
      const body = await readFile(join(target, path));
      return { path, digest: sha256(body), byteSize: body.byteLength };
    }),
  );
  const sbomPath = "sbom/release.spdx.json";
  const provenancePath = "provenance/release.intoto.jsonl";
  if (stagedPaths.has(sbomPath) || stagedPaths.has(provenancePath)) {
    throw new Error("BUNDLE_GENERATED_MATERIAL_COLLISION");
  }
  const sbom = spdxDocument({
    releaseVersion: metadata.releaseVersion,
    files: preSbomFiles,
    images: metadata.images,
  });
  await atomicWrite(join(target, sbomPath), `${JSON.stringify(sbom, null, 2)}\n`);
  const provenance = {
    _type: "https://in-toto.io/Statement/v1",
    subject: preSbomFiles.map((file) => ({
      name: file.path,
      digest: { sha256: file.digest.slice("sha256:".length) },
    })),
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://avermate.local/build/full-self-host-offline-bundle/v1",
        externalParameters: {
          releaseVersion: metadata.releaseVersion,
          previousReleaseVersion: metadata.previousReleaseVersion,
        },
        internalParameters: { networkAccess: false },
        resolvedDependencies: [],
      },
      runDetails: {
        builder: { id: "https://avermate.local/builders/node-bundle-v1" },
        metadata: {
          invocationId: `bundle:${metadata.releaseVersion}`,
          startedOn: (input.now ?? new Date()).toISOString(),
          finishedOn: (input.now ?? new Date()).toISOString(),
        },
      },
    },
  };
  await atomicWrite(join(target, provenancePath), `${JSON.stringify(provenance)}\n`);

  const materialPaths = await listMaterialFiles(target);
  const files = await Promise.all(
    materialPaths.map(async (path) => {
      const body = await readFile(join(target, path));
      return {
        path,
        digest: sha256(body),
        byteSize: body.byteLength,
        mode: 0o600,
      };
    }),
  );
  const digestByPath = new Map(files.map((file) => [file.path, file.digest]));
  const manifest = releaseManifestSchema.parse({
    schemaVersion: 1,
    product: "avermate-full-self-host",
    releaseVersion: metadata.releaseVersion,
    previousReleaseVersion: metadata.previousReleaseVersion,
    createdAt: (input.now ?? new Date()).toISOString(),
    components: ["web", "core", "node", "migrations", "verification"],
    files,
    images: metadata.images.map((image) => ({ ...image, sbomPath })),
    models: metadata.models,
    migrations: metadata.migrations.map((migration) => ({
      ...migration,
      digest: digestByPath.get(migration.path),
    })),
    provenancePath,
    noticesPath: metadata.noticesPath,
    verificationEntrypoint: metadata.verificationEntrypoint,
    airgap: {
      externalDestinations: [],
      registryPullsAfterImport: false,
      telemetry: false,
      managedServices: false,
      hostedCore: false,
    },
  });
  const privateKey = createPrivateKey(
    await readFile(resolve(input.privateKeyPath), "utf8"),
  );
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("RELEASE_SIGNING_KEY_MUST_BE_ED25519");
  }
  const signed = signedReleaseManifestSchema.parse({
    manifest,
    keyId: metadata.keyId,
    algorithm: "ed25519",
    signature: sign(
      null,
      Buffer.from(canonicalJson(manifest)),
      privateKey,
    ).toString("base64url"),
  });
  await atomicWrite(
    join(target, "release-manifest.json"),
    `${JSON.stringify(signed, null, 2)}\n`,
  );
  return Object.freeze({
    built: true as const,
    outputDir: target,
    releaseVersion: manifest.releaseVersion,
    fileCount: manifest.files.length,
    manifest,
  });
}

export async function verifyReleaseBundle(input: {
  bundleDir: string;
  publicKeyPath: string;
}) {
  const root = assertSafeTarget(input.bundleDir);
  const signed = await readSignedManifest(root);
  await verifySignature(signed, input.publicKeyPath);
  const materialPaths = await listMaterialFiles(root);
  const expected = new Set([
    "release-manifest.json",
    ...signed.manifest.files.map((file) => file.path),
  ]);
  if (
    materialPaths.length !== expected.size ||
    materialPaths.some((path) => !expected.has(path))
  ) {
    throw new Error("BUNDLE_FILE_SET_MISMATCH");
  }
  for (const file of signed.manifest.files) {
    const path = resolve(root, file.path);
    if (!within(root, path)) throw new Error("BUNDLE_PATH_ESCAPE");
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("BUNDLE_FILE_INVALID");
    }
    const body = await readFile(path);
    if (body.byteLength !== file.byteSize || sha256(body) !== file.digest) {
      throw new Error("BUNDLE_FILE_DIGEST_MISMATCH");
    }
  }
  return Object.freeze({
    valid: true as const,
    releaseVersion: signed.manifest.releaseVersion,
    previousReleaseVersion: signed.manifest.previousReleaseVersion,
    keyId: signed.keyId,
    fileCount: signed.manifest.files.length,
    images: signed.manifest.images.map((image) => image.reference),
    airgapDeclared: true as const,
    staticVerified: true as const,
    liveAirgapProven: false as const,
    manifest: signed.manifest,
  });
}

export async function importReleaseBundle(input: {
  bundleDir: string;
  publicKeyPath: string;
  targetDir: string;
}) {
  const verified = await verifyReleaseBundle(input);
  const source = resolve(input.bundleDir);
  const target = await assertEmptyDirectory(input.targetDir);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const signedBody = await readFile(join(source, "release-manifest.json"));
  await atomicWrite(join(target, "release-manifest.json"), signedBody);
  for (const file of verified.manifest.files) {
    await atomicWrite(
      join(target, file.path),
      await readFile(join(source, file.path)),
      file.mode,
    );
  }
  const imported = await verifyReleaseBundle({
    bundleDir: target,
    publicKeyPath: input.publicKeyPath,
  });
  return Object.freeze({
    imported: true as const,
    targetDir: target,
    ...imported,
  });
}

export async function planNodeUpgrade(input: {
  config: NodeConfig;
  bundleDir: string;
  publicKeyPath: string;
}) {
  const release = await verifyReleaseBundle(input);
  if (release.previousReleaseVersion !== input.config.lifecycle.releaseVersion) {
    throw new Error("UPGRADE_ONLY_EXACT_N_MINUS_ONE_SUPPORTED");
  }
  return Object.freeze({
    currentReleaseVersion: input.config.lifecycle.releaseVersion,
    targetReleaseVersion: release.releaseVersion,
    backupRequired: true as const,
    appendOnlyMigrations: release.manifest.migrations.map((migration) => ({
      id: migration.id,
      digest: migration.digest,
    })),
    release,
  });
}

export async function applyNodeUpgrade(input: {
  config: NodeConfig;
  configPath: string;
  bundleDir: string;
  publicKeyPath: string;
  backupPath: string;
  backupKey: Uint8Array;
}) {
  const plan = await planNodeUpgrade(input);
  const backup = await createNodeBackup({
    config: input.config,
    configPath: input.configPath,
    outputPath: input.backupPath,
    key: input.backupKey,
  });
  await verifyNodeBackup({ archivePath: backup.outputPath, key: input.backupKey });
  const releaseDir = resolve(
    input.config.dataDir,
    "releases",
    plan.targetReleaseVersion,
  );
  await importReleaseBundle({
    bundleDir: input.bundleDir,
    publicKeyPath: input.publicKeyPath,
    targetDir: releaseDir,
  });
  const next = nodeConfigSchema.parse({
    ...input.config,
    lifecycle: {
      ...input.config.lifecycle,
      previousReleaseVersion: input.config.lifecycle.releaseVersion,
      releaseVersion: plan.targetReleaseVersion,
      releaseManifestPath: join(releaseDir, "release-manifest.json"),
      releaseSigningPublicKeyPath: resolve(input.publicKeyPath),
    },
  });
  await atomicWrite(resolve(input.configPath), serializeNodeConfig(next));
  return Object.freeze({
    applied: true as const,
    currentReleaseVersion: next.lifecycle.releaseVersion,
    previousReleaseVersion: next.lifecycle.previousReleaseVersion,
    configRevision: configRevision(next),
    backupPath: backup.outputPath,
    backupDigest: backup.archiveDigest,
    releaseDir,
    migrationsApplied: false as const,
    migrationRequirement:
      "Run the signed, append-only Core migration gate from this imported release before routing traffic.",
  });
}

export async function verifyNodeUpgrade(input: {
  config: NodeConfig;
  publicKeyPath: string;
}) {
  const manifestPath = input.config.lifecycle.releaseManifestPath;
  if (!manifestPath) throw new Error("UPGRADE_RELEASE_MANIFEST_MISSING");
  const releaseDir = dirname(resolve(manifestPath));
  const verified = await verifyReleaseBundle({
    bundleDir: releaseDir,
    publicKeyPath: input.publicKeyPath,
  });
  if (verified.releaseVersion !== input.config.lifecycle.releaseVersion) {
    throw new Error("UPGRADE_RELEASE_VERSION_MISMATCH");
  }
  return Object.freeze({
    valid: true as const,
    releaseVersion: verified.releaseVersion,
    releaseFilesVerified: true as const,
    migrationsVerified: false as const,
    trafficReady: false as const,
    reason: "CORE_MIGRATION_AND_LIVE_CAPABILITY_GATES_REQUIRED",
  });
}
