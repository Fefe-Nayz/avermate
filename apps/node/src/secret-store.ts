import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { nodeSecretReferenceSchema } from "./config";

const secretNamePattern = /^[a-z][a-z0-9._-]{0,63}$/u;
const MAX_SECRET_BYTES = 64 * 1024;

function secretName(name: string) {
  if (!secretNamePattern.test(name)) throw new Error("NODE_SECRET_NAME_INVALID");
  return name;
}

async function assertOwnerOnlyFile(path: string) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("NODE_SECRET_FILE_TYPE_INVALID");
  }
  if (metadata.size < 1 || metadata.size > MAX_SECRET_BYTES) {
    throw new Error("NODE_SECRET_VALUE_INVALID");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("NODE_SECRET_FILE_PERMISSIONS_TOO_OPEN");
  }
}

async function atomicSecret(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${crypto.randomUUID()}.tmp`,
  );
  await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Owner-local secret storage. Config files contain only `secret:name` refs. */
export class NodeSecretStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  reference(name: string) {
    return `secret:${secretName(name)}` as const;
  }

  async put(name: string, value: string) {
    const normalized = value.trim();
    const bytes = new TextEncoder().encode(normalized).byteLength;
    if (bytes < 1 || bytes > MAX_SECRET_BYTES) {
      throw new Error("NODE_SECRET_VALUE_INVALID");
    }
    await atomicSecret(this.#path(name), `${normalized}\n`);
    await assertOwnerOnlyFile(this.#path(name));
    return this.reference(name);
  }

  async read(reference: string) {
    const parsed = nodeSecretReferenceSchema.parse(reference);
    let path: string;
    if (parsed.startsWith("secret:")) {
      path = this.#path(parsed.slice("secret:".length));
    } else if (parsed.startsWith("file:")) {
      path = fileURLToPath(parsed);
    } else {
      path = resolve(parsed);
    }
    await assertOwnerOnlyFile(path);
    const value = (await readFile(path, "utf8")).trim();
    if (new TextEncoder().encode(value).byteLength > MAX_SECRET_BYTES) {
      throw new Error("NODE_SECRET_VALUE_INVALID");
    }
    return value;
  }

  async has(name: string) {
    try {
      await stat(this.#path(name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async delete(name: string) {
    await rm(this.#path(name), { force: true });
  }

  #path(name: string) {
    return join(this.#root, `${secretName(name)}.secret`);
  }
}
