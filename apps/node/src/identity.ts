import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson } from "./canonical-json";

type PersistedNodeIdentityV1 = {
  version: 1;
  nodeId: string;
  keyId: string;
  publicKeyDer: string;
  privateKeyPem: string;
  createdAt: string;
};

export type NodeIdentity = {
  nodeId: string;
  keyId: string;
  publicKeyDer: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
  createdAt: string;
};

function encodeBase64Url(value: Uint8Array | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function decodePersisted(input: PersistedNodeIdentityV1): NodeIdentity {
  const publicKey = createPublicKey({
    key: Buffer.from(input.publicKeyDer, "base64url"),
    type: "spki",
    format: "der",
  });
  const privateKey = createPrivateKey(input.privateKeyPem);
  const derived = createHash("sha256")
    .update(Buffer.from(input.publicKeyDer, "base64url"))
    .digest("base64url")
    .slice(0, 32);
  if (
    input.nodeId !== `node_${derived}` ||
    input.keyId !== `ed25519_${derived}`
  ) {
    throw new Error("NODE_IDENTITY_KEY_MISMATCH");
  }
  return { ...input, publicKey, privateKey };
}

export async function loadOrCreateNodeIdentity(
  path: string,
): Promise<NodeIdentity> {
  try {
    const parsed = JSON.parse(
      await readFile(path, "utf8"),
    ) as PersistedNodeIdentityV1;
    if (parsed.version !== 1)
      throw new Error("UNSUPPORTED_NODE_IDENTITY_VERSION");
    return decodePersisted(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const pair = generateKeyPairSync("ed25519");
  const publicKeyDer = encodeBase64Url(
    pair.publicKey.export({ type: "spki", format: "der" }),
  );
  const derived = createHash("sha256")
    .update(Buffer.from(publicKeyDer, "base64url"))
    .digest("base64url")
    .slice(0, 32);
  const persisted: PersistedNodeIdentityV1 = {
    version: 1,
    nodeId: `node_${derived}`,
    keyId: `ed25519_${derived}`,
    publicKeyDer,
    privateKeyPem: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    createdAt: new Date().toISOString(),
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(persisted)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
  return decodePersisted(persisted);
}

export function signCanonical(identity: NodeIdentity, value: unknown): string {
  return sign(
    null,
    Buffer.from(canonicalJson(value)),
    identity.privateKey,
  ).toString("base64url");
}

export function verifyCanonical(
  publicKeyDer: string,
  value: unknown,
  signature: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(value)),
      createPublicKey({
        key: Buffer.from(publicKeyDer, "base64url"),
        type: "spki",
        format: "der",
      }),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function safeSecretEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
