import { z } from "zod";
import {
  fileHandleAudienceSchema,
  fileHandleProjectionSchema,
  opaqueFileHandleSchema,
  type FileHandleAudience,
  type FileHandleProjection,
  type OpaqueFileHandle,
} from "@avermate/agent-contracts";

const payloadSchema = z.strictObject({
  version: z.literal(1),
  fileId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
  audience: fileHandleAudienceSchema,
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  nonce: z.string().uuid(),
});

const aad = new TextEncoder().encode("avermate:opaque-file-handle:v1");
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class FileHandleResolutionError extends Error {
  constructor() {
    super("The file handle is invalid or unavailable");
    this.name = "FileHandleResolutionError";
  }
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new FileHandleResolutionError();
  return new Uint8Array(Buffer.from(value, "base64url"));
}

export type ResolvedFileHandle = {
  fileId: string;
  userId: string;
  audience: FileHandleAudience;
  expiresAt: Date;
};

/**
 * Stateless AES-GCM capability. The encrypted payload is opaque to clients;
 * current ownership and revocation are deliberately re-checked at exchange.
 */
export class FileHandleService {
  readonly #key: Promise<CryptoKey>;

  constructor(secret: string) {
    if (encoder.encode(secret).byteLength < 32) {
      throw new Error("The file-handle secret must contain at least 32 bytes");
    }
    this.#key = crypto.subtle
      .digest("SHA-256", encoder.encode(`file-handle\0${secret}`))
      .then((digest) =>
        crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
          "encrypt",
          "decrypt",
        ]),
      );
  }

  async mint(input: {
    fileId: string;
    userId: string;
    audience: FileHandleAudience;
    mimeType: string;
    byteSize: number;
    ttlMs?: number;
    now?: Date;
  }): Promise<FileHandleProjection> {
    const now = (input.now ?? new Date()).getTime();
    const ttlMs = input.ttlMs ?? 10 * 60_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60_000) {
      throw new Error("File handles must expire within 1 second to 15 minutes");
    }
    const payload = payloadSchema.parse({
      version: 1,
      fileId: input.fileId,
      userId: input.userId,
      audience: input.audience,
      issuedAt: now,
      expiresAt: now + ttlMs,
      nonce: crypto.randomUUID(),
    });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
        await this.#key,
        encoder.encode(JSON.stringify(payload)),
      ),
    );
    const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
    packed.set(iv);
    packed.set(encrypted, iv.byteLength);
    return fileHandleProjectionSchema.parse({
      handle: `fh1.${base64Url(packed)}`,
      audience: input.audience,
      expiresAt: new Date(payload.expiresAt).toISOString(),
      mimeType: input.mimeType,
      byteSize: input.byteSize,
    });
  }

  async resolve(input: {
    handle: OpaqueFileHandle | string;
    userId: string;
    audience: FileHandleAudience;
    now?: Date;
  }): Promise<ResolvedFileHandle> {
    try {
      const handle = opaqueFileHandleSchema.parse(input.handle);
      const packed = fromBase64Url(handle.slice(4));
      if (packed.byteLength < 12 + 16 + 2)
        throw new FileHandleResolutionError();
      const iv = packed.slice(0, 12);
      const ciphertext = packed.slice(12);
      const cleartext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
        await this.#key,
        ciphertext,
      );
      const payload = payloadSchema.parse(
        JSON.parse(decoder.decode(new Uint8Array(cleartext))),
      );
      const now = (input.now ?? new Date()).getTime();
      if (
        payload.userId !== input.userId ||
        payload.audience !== input.audience ||
        payload.expiresAt <= now ||
        payload.issuedAt > now + 30_000 ||
        payload.expiresAt - payload.issuedAt > 15 * 60_000
      ) {
        throw new FileHandleResolutionError();
      }
      return {
        fileId: payload.fileId,
        userId: payload.userId,
        audience: payload.audience,
        expiresAt: new Date(payload.expiresAt),
      };
    } catch (error) {
      if (error instanceof FileHandleResolutionError) throw error;
      throw new FileHandleResolutionError();
    }
  }
}
