import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { env } from "./env";

const VERSION = "v1";
const IV_BYTES = 12;

function sealingKey() {
  return Buffer.from(
    hkdfSync(
      "sha256",
      env.BETTER_AUTH_SECRET,
      "avermate-sync",
      "credential-sealing",
      32,
    ),
  );
}

/** Seal a server-side secret using the instance authentication secret. */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/** Open a value produced by {@link seal}; malformed or tampered data rejects. */
export function open(sealed: string): string {
  const [version, encodedIv, encodedCiphertext, encodedTag, extra] =
    sealed.split(".");
  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedCiphertext ||
    !encodedTag ||
    extra
  ) {
    throw new Error("Unsupported sealed credential format");
  }
  const iv = Buffer.from(encodedIv, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  const tag = Buffer.from(encodedTag, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error("Invalid sealed credential envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", sealingKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}
