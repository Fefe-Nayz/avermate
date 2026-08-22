import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function base64url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export class NodeCredentialVault {
  readonly #encryptionKey: Buffer;
  readonly #hashKey: Buffer;

  constructor(masterSecret: string) {
    if (new TextEncoder().encode(masterSecret).byteLength < 32) {
      throw new Error("NODE_CREDENTIAL_MASTER_SECRET_TOO_SHORT");
    }
    const material = Buffer.from(masterSecret);
    this.#encryptionKey = Buffer.from(
      hkdfSync("sha256", material, Buffer.from("avermate-node-v1"), Buffer.from("seal"), 32),
    );
    this.#hashKey = Buffer.from(
      hkdfSync("sha256", material, Buffer.from("avermate-node-v1"), Buffer.from("hash"), 32),
    );
  }

  generate() {
    return `nc_${base64url(randomBytes(48))}`;
  }

  hash(credential: string) {
    return `sha256:${createHmac("sha256", this.#hashKey)
      .update(credential)
      .digest("hex")}` as const;
  }

  matches(credential: string, expectedHash: string) {
    const observed = Buffer.from(this.hash(credential));
    const expected = Buffer.from(expectedHash);
    return (
      observed.byteLength === expected.byteLength &&
      timingSafeEqual(observed, expected)
    );
  }

  seal(credential: string, context: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#encryptionKey, nonce);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([
      cipher.update(credential, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1.${base64url(nonce)}.${base64url(ciphertext)}.${base64url(tag)}`;
  }

  open(sealed: string, context: string) {
    const [version, nonceValue, ciphertextValue, tagValue, extra] =
      sealed.split(".");
    if (
      version !== "v1" ||
      !nonceValue ||
      !ciphertextValue ||
      !tagValue ||
      extra !== undefined
    ) {
      throw new Error("NODE_CREDENTIAL_SEALED_FORMAT_INVALID");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#encryptionKey,
        decode(nonceValue),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(decode(tagValue));
      return Buffer.concat([
        decipher.update(decode(ciphertextValue)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("NODE_CREDENTIAL_SEALED_VALUE_INVALID");
    }
  }
}
