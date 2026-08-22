import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from "node:path";
import { parse } from "yaml";
import {
  configRevision,
  nodeConfigSchema,
  serializeNodeConfig,
  type NodeConfig,
} from "./config";

const BACKUP_FORMAT = "avermate-node-backup-v1";
const BACKUP_ALGORITHM = "aes-256-gcm";
const RESTORE_MARKER = ".avermate-node-restore-v1.json";
const maximumBackupFileBytes = 50 * 1024 ** 3;
const maximumBackupFiles = 1_000_000;

type BackupFileInventory = {
  path: string;
  byteSize: number;
  digest: `sha256:${string}`;
  mode: number;
};

type BackupPayload = {
  version: 1;
  createdAt: string;
  nodeId: string;
  configRevision: `sha256:${string}`;
  sourceDataDir: string;
  configBody: string;
  files: Array<BackupFileInventory & { body: string }>;
};

type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  algorithm: typeof BACKUP_ALGORITHM;
  createdAt: string;
  nonce: string;
  authenticationTag: string;
  ciphertext: string;
};

function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function within(parent: string, candidate: string) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function safeRelativePath(path: string) {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("BACKUP_PATH_INVALID");
  }
  return path;
}

function assertSafeTarget(path: string) {
  const target = resolve(path);
  if (parsePath(target).root === target) {
    throw new Error("LIFECYCLE_TARGET_TOO_BROAD");
  }
  return target;
}

function resolveConfiguredPath(value: string) {
  return resolve(value);
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

async function assertEmptyTarget(path: string) {
  const target = assertSafeTarget(path);
  if (!(await exists(target))) return target;
  const metadata = await lstat(target);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("RESTORE_TARGET_NOT_EMPTY");
  }
  if ((await readdir(target)).length !== 0) {
    throw new Error("RESTORE_TARGET_NOT_EMPTY");
  }
  return target;
}

async function atomicWrite(path: string, bytes: Uint8Array | string, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx", mode });
  await rename(temporary, path);
  await chmod(path, mode).catch(() => undefined);
}

async function collectFiles(input: {
  root: string;
  excludedRoots?: readonly string[];
}): Promise<BackupFileInventory[]> {
  const root = resolve(input.root);
  const excludedRoots = (input.excludedRoots ?? []).map((path) =>
    resolve(path),
  );
  const result: BackupFileInventory[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      if (!within(root, absolute)) throw new Error("BACKUP_PATH_ESCAPE");
      if (excludedRoots.some((excluded) => within(excluded, absolute))) {
        continue;
      }
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error("BACKUP_SYMLINK_DENIED");
      if (metadata.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!metadata.isFile()) throw new Error("BACKUP_SPECIAL_FILE_DENIED");
      if (metadata.size > maximumBackupFileBytes) {
        throw new Error("BACKUP_FILE_TOO_LARGE");
      }
      const path = safeRelativePath(relative(root, absolute).replaceAll("\\", "/"));
      const body = await readFile(absolute);
      if (body.byteLength !== metadata.size) throw new Error("BACKUP_FILE_CHANGED");
      result.push({
        path,
        byteSize: body.byteLength,
        digest: sha256(body),
        mode: metadata.mode & 0o777,
      });
      if (result.length > maximumBackupFiles) {
        throw new Error("BACKUP_FILE_COUNT_EXCEEDED");
      }
    }
  }

  if (await exists(root)) {
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("BACKUP_DATA_DIRECTORY_INVALID");
    }
    await visit(root);
  }
  return result;
}

function backupRoot(config: NodeConfig) {
  return resolveConfiguredPath(config.lifecycle.backupDir);
}

export async function readBackupKey(path: string) {
  const body = await readFile(resolve(path));
  if (body.byteLength === 32) return body;
  const value = body.toString("utf8").trim();
  const decoded = /^[a-f0-9]{64}$/iu.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32) throw new Error("BACKUP_KEY_MUST_BE_32_BYTES");
  return decoded;
}

export async function planNodeBackup(input: {
  configPath: string;
  config: NodeConfig;
}) {
  const dataDir = resolveConfiguredPath(input.config.dataDir);
  const configuredBackupRoot = backupRoot(input.config);
  const excludedRoots = within(dataDir, configuredBackupRoot)
    ? [configuredBackupRoot]
    : [];
  const files = await collectFiles({ root: dataDir, excludedRoots });
  const identity = files.find((file) => file.path === "secrets/identity.json");
  let nodeId = "uninitialized";
  if (identity) {
    const parsed = JSON.parse(
      await readFile(join(dataDir, identity.path), "utf8"),
    ) as { nodeId?: unknown };
    if (typeof parsed.nodeId !== "string" || !parsed.nodeId.startsWith("node_")) {
      throw new Error("BACKUP_IDENTITY_INVALID");
    }
    nodeId = parsed.nodeId;
  }
  return Object.freeze({
    format: BACKUP_FORMAT,
    configPath: resolve(input.configPath),
    dataDir,
    backupDir: configuredBackupRoot,
    nodeId,
    configRevision: configRevision(input.config),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.byteSize, 0),
    files,
  });
}

function parseEnvelope(bytes: Uint8Array): BackupEnvelope {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Partial<BackupEnvelope>;
  if (
    parsed.format !== BACKUP_FORMAT ||
    parsed.algorithm !== BACKUP_ALGORITHM ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.authenticationTag !== "string" ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new Error("BACKUP_FORMAT_INVALID");
  }
  return parsed as BackupEnvelope;
}

function decodeBackup(bytes: Uint8Array, key: Uint8Array): BackupPayload {
  if (key.byteLength !== 32) throw new Error("BACKUP_KEY_MUST_BE_32_BYTES");
  const envelope = parseEnvelope(bytes);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(`${envelope.format}\0${envelope.createdAt}`));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8")) as BackupPayload;
    if (
      payload.version !== 1 ||
      typeof payload.createdAt !== "string" ||
      typeof payload.nodeId !== "string" ||
      typeof payload.configBody !== "string" ||
      !Array.isArray(payload.files)
    ) {
      throw new Error("BACKUP_PAYLOAD_INVALID");
    }
    const paths = new Set<string>();
    for (const file of payload.files) {
      safeRelativePath(file.path);
      if (paths.has(file.path)) throw new Error("BACKUP_DUPLICATE_PATH");
      paths.add(file.path);
      const body = Buffer.from(file.body, "base64");
      if (
        body.byteLength !== file.byteSize ||
        sha256(body) !== file.digest ||
        file.byteSize > maximumBackupFileBytes
      ) {
        throw new Error("BACKUP_FILE_DIGEST_MISMATCH");
      }
    }
    if (payload.files.length > maximumBackupFiles) {
      throw new Error("BACKUP_FILE_COUNT_EXCEEDED");
    }
    const config = nodeConfigSchema.parse(parse(payload.configBody));
    if (configRevision(config) !== payload.configRevision) {
      throw new Error("BACKUP_CONFIG_DIGEST_MISMATCH");
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BACKUP_")) throw error;
    throw new Error("BACKUP_AUTHENTICATION_FAILED", { cause: error });
  }
}

export async function createNodeBackup(input: {
  configPath: string;
  config: NodeConfig;
  outputPath: string;
  key: Uint8Array;
  now?: Date;
}) {
  const output = assertSafeTarget(input.outputPath);
  if (await exists(output)) throw new Error("BACKUP_OUTPUT_EXISTS");
  const plan = await planNodeBackup(input);
  const files = await Promise.all(
    plan.files.map(async (file) => {
      const body = await readFile(join(plan.dataDir, file.path));
      if (body.byteLength !== file.byteSize || sha256(body) !== file.digest) {
        throw new Error("BACKUP_FILE_CHANGED");
      }
      return { ...file, body: body.toString("base64") };
    }),
  );
  const createdAt = (input.now ?? new Date()).toISOString();
  const payload: BackupPayload = {
    version: 1,
    createdAt,
    nodeId: plan.nodeId,
    configRevision: plan.configRevision,
    sourceDataDir: plan.dataDir,
    configBody: serializeNodeConfig(input.config),
    files,
  };
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.key, nonce);
  cipher.setAAD(Buffer.from(`${BACKUP_FORMAT}\0${createdAt}`));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload))),
    cipher.final(),
  ]);
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    algorithm: BACKUP_ALGORITHM,
    createdAt,
    nonce: nonce.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  const bytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
  await atomicWrite(output, bytes);
  const archiveDigest = sha256(bytes);
  await atomicWrite(`${output}.sha256`, `${archiveDigest}  ${output.split(/[\\/]/u).at(-1)}\n`);
  return Object.freeze({ ...plan, outputPath: output, archiveDigest, createdAt });
}

export async function verifyNodeBackup(input: {
  archivePath: string;
  key: Uint8Array;
}) {
  const archivePath = resolve(input.archivePath);
  const bytes = await readFile(archivePath);
  const payload = decodeBackup(bytes, input.key);
  const sidecarPath = `${archivePath}.sha256`;
  if (await exists(sidecarPath)) {
    const expected = (await readFile(sidecarPath, "utf8")).trim().split(/\s+/u)[0];
    if (expected !== sha256(bytes)) throw new Error("BACKUP_ARCHIVE_DIGEST_MISMATCH");
  }
  return Object.freeze({
    valid: true as const,
    format: BACKUP_FORMAT,
    archiveDigest: sha256(bytes),
    createdAt: payload.createdAt,
    nodeId: payload.nodeId,
    configRevision: payload.configRevision,
    fileCount: payload.files.length,
    totalBytes: payload.files.reduce((sum, file) => sum + file.byteSize, 0),
  });
}

function relocatedConfig(payload: BackupPayload, targetDataDir: string) {
  const original = nodeConfigSchema.parse(parse(payload.configBody));
  const relocate = (path: string) => {
    const source = resolve(path);
    return within(payload.sourceDataDir, source)
      ? join(targetDataDir, relative(payload.sourceDataDir, source))
      : path;
  };
  return nodeConfigSchema.parse({
    ...original,
    dataDir: targetDataDir,
    storage: {
      ...original.storage,
      ...(original.storage.filesystemRoot
        ? { filesystemRoot: relocate(original.storage.filesystemRoot) }
        : {}),
    },
    lifecycle: {
      ...original.lifecycle,
      backupDir: relocate(original.lifecycle.backupDir),
    },
  });
}

export async function planNodeRestore(input: {
  archivePath: string;
  key: Uint8Array;
  targetDataDir: string;
  targetConfigPath: string;
}) {
  const targetDataDir = await assertEmptyTarget(input.targetDataDir);
  const targetConfigPath = assertSafeTarget(input.targetConfigPath);
  if (await exists(targetConfigPath)) throw new Error("RESTORE_CONFIG_EXISTS");
  const bytes = await readFile(resolve(input.archivePath));
  const payload = decodeBackup(bytes, input.key);
  const config = relocatedConfig(payload, targetDataDir);
  return Object.freeze({
    archiveDigest: sha256(bytes),
    nodeId: payload.nodeId,
    sourceConfigRevision: payload.configRevision,
    restoredConfigRevision: configRevision(config),
    targetDataDir,
    targetConfigPath,
    fileCount: payload.files.length,
    totalBytes: payload.files.reduce((sum, file) => sum + file.byteSize, 0),
    config,
    payload,
  });
}

export async function restoreNodeBackup(input: {
  archivePath: string;
  key: Uint8Array;
  targetDataDir: string;
  targetConfigPath: string;
}) {
  const plan = await planNodeRestore(input);
  await mkdir(plan.targetDataDir, { recursive: false, mode: 0o700 }).catch(
    async (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await readdir(plan.targetDataDir)).length !== 0) throw error;
    },
  );
  for (const file of plan.payload.files) {
    const target = resolve(plan.targetDataDir, file.path);
    if (!within(plan.targetDataDir, target)) throw new Error("RESTORE_PATH_ESCAPE");
    await atomicWrite(target, Buffer.from(file.body, "base64"), file.mode || 0o600);
  }
  await atomicWrite(plan.targetConfigPath, serializeNodeConfig(plan.config));
  const marker = {
    version: 1,
    archiveDigest: plan.archiveDigest,
    nodeId: plan.nodeId,
    sourceConfigRevision: plan.sourceConfigRevision,
    restoredConfigRevision: plan.restoredConfigRevision,
    restoredAt: new Date().toISOString(),
  };
  await atomicWrite(
    join(plan.targetDataDir, RESTORE_MARKER),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
  return Object.freeze({
    restored: true as const,
    ...marker,
    targetDataDir: plan.targetDataDir,
    targetConfigPath: plan.targetConfigPath,
    fileCount: plan.fileCount,
  });
}

export async function verifyNodeRestore(input: {
  archivePath: string;
  key: Uint8Array;
  targetDataDir: string;
  targetConfigPath: string;
}) {
  const dataDir = assertSafeTarget(input.targetDataDir);
  const configPath = assertSafeTarget(input.targetConfigPath);
  const bytes = await readFile(resolve(input.archivePath));
  const payload = decodeBackup(bytes, input.key);
  const expected = new Map(payload.files.map((file) => [file.path, file]));
  const actual = await collectFiles({ root: dataDir });
  const material = actual.filter((file) => file.path !== RESTORE_MARKER);
  if (material.length !== expected.size) throw new Error("RESTORE_FILE_SET_MISMATCH");
  for (const file of material) {
    const source = expected.get(file.path);
    if (!source || source.digest !== file.digest || source.byteSize !== file.byteSize) {
      throw new Error("RESTORE_FILE_DIGEST_MISMATCH");
    }
  }
  const marker = JSON.parse(
    await readFile(join(dataDir, RESTORE_MARKER), "utf8"),
  ) as { archiveDigest?: unknown; nodeId?: unknown };
  if (marker.archiveDigest !== sha256(bytes) || marker.nodeId !== payload.nodeId) {
    throw new Error("RESTORE_MARKER_MISMATCH");
  }
  const config = nodeConfigSchema.parse(parse(await readFile(configPath, "utf8")));
  if (resolve(config.dataDir) !== dataDir) throw new Error("RESTORE_CONFIG_TARGET_MISMATCH");
  return Object.freeze({
    valid: true as const,
    archiveDigest: sha256(bytes),
    nodeId: payload.nodeId,
    configRevision: configRevision(config),
    fileCount: material.length,
  });
}

export async function generateBackupKey(path: string) {
  const target = assertSafeTarget(path);
  if (await exists(target)) throw new Error("BACKUP_KEY_EXISTS");
  const key = randomBytes(32);
  await atomicWrite(target, `${key.toString("base64url")}\n`);
  return { path: target, fingerprint: sha256(key) };
}
