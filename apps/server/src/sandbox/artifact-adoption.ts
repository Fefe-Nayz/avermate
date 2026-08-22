import { createHash } from "node:crypto";
import type {
  SandboxFileManifestEntry,
  SandboxHandle,
  SandboxProvider,
} from "@avermate/agent-contracts";
import { SandboxArtifactError } from "./errors";
import { assertSafeRelativePath } from "./policy";

export interface ArtifactStagingUpload {
  write(chunk: Uint8Array): Promise<void>;
  commit(input: { digest: string; byteSize: number; mimeType: string }): Promise<string>;
  abort(): Promise<void>;
}

export interface TrustedArtifactObjectStore {
  begin(input: {
    ownerId: string;
    purpose: string;
    expectedMaxBytes: number;
  }): Promise<ArtifactStagingUpload>;
  revoke?(objectRef: string): Promise<void>;
}

export interface ArtifactAdoptionPolicy {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  allowedPathPrefixes: readonly string[];
  allowedKinds: readonly SandboxFileManifestEntry["kind"][];
  allowOpaqueBinary?: boolean;
}

export interface ArtifactProvenance {
  ownerId: string;
  purpose: string;
  jobId: string;
  toolCallId: string;
  profileVersion: string;
  imageDigest: string;
  inputRevision: string;
}

export interface AdoptedArtifact {
  objectRef: string;
  relativePath: string;
  digest: string;
  byteSize: number;
  mimeType: string;
  kind: SandboxFileManifestEntry["kind"];
  provenance: ArtifactProvenance;
}

type VerifiedStage = {
  entry: SandboxFileManifestEntry;
  upload: ArtifactStagingUpload;
};

/**
 * Copies untrusted outputs into a staging namespace, verifies them while
 * streaming, and only then commits opaque object references. Sandbox paths are
 * never returned as trusted application artefacts.
 */
export async function adoptSandboxArtifacts(input: {
  provider: SandboxProvider;
  handle: SandboxHandle;
  manifest: readonly SandboxFileManifestEntry[];
  policy: ArtifactAdoptionPolicy;
  store: TrustedArtifactObjectStore;
  provenance: ArtifactProvenance;
}): Promise<readonly AdoptedArtifact[]> {
  validateManifest(input.manifest, input.policy);
  const staged: VerifiedStage[] = [];
  const committed: string[] = [];

  try {
    for (const entry of input.manifest) {
      const upload = await input.store.begin({
        ownerId: input.provenance.ownerId,
        purpose: input.provenance.purpose,
        expectedMaxBytes: entry.byteSize,
      });
      staged.push({ entry, upload });
      await streamAndVerify({
        chunks: input.provider.readFile(input.handle, entry.relativePath),
        entry,
        upload,
      });
    }

    const adopted: AdoptedArtifact[] = [];
    for (const { entry, upload } of staged) {
      const objectRef = await upload.commit({
        digest: entry.digest,
        byteSize: entry.byteSize,
        mimeType: entry.mimeType,
      });
      committed.push(objectRef);
      adopted.push(
        Object.freeze({
          objectRef,
          relativePath: entry.relativePath,
          digest: entry.digest,
          byteSize: entry.byteSize,
          mimeType: entry.mimeType,
          kind: entry.kind,
          provenance: Object.freeze({ ...input.provenance }),
        }),
      );
    }
    return Object.freeze(adopted);
  } catch (cause) {
    await Promise.allSettled(staged.map(({ upload }) => upload.abort()));
    if (input.store.revoke) {
      await Promise.allSettled(committed.map((objectRef) => input.store.revoke?.(objectRef)));
    }
    if (cause instanceof SandboxArtifactError) throw cause;
    throw new SandboxArtifactError(
      "STORE_FAILED",
      cause instanceof Error ? cause.message : "Artifact adoption failed.",
    );
  }
}

function validateManifest(
  manifest: readonly SandboxFileManifestEntry[],
  policy: ArtifactAdoptionPolicy,
): void {
  if (manifest.length === 0 || manifest.length > policy.maxFiles) {
    throw new SandboxArtifactError("LIMIT_EXCEEDED", "Artifact count is outside policy.");
  }
  const seen = new Set<string>();
  let total = 0;
  for (const entry of manifest) {
    try {
      assertSafeRelativePath(entry.relativePath);
    } catch {
      throw new SandboxArtifactError("UNSAFE_PATH", `Unsafe artifact path: ${entry.relativePath}`);
    }
    const folded = entry.relativePath.normalize("NFC").toLocaleLowerCase("en-US");
    if (seen.has(folded)) {
      throw new SandboxArtifactError("INVALID_MANIFEST", "Duplicate or case-colliding paths.");
    }
    seen.add(folded);
    if (entry.nodeType !== "file") {
      throw new SandboxArtifactError("UNSAFE_NODE", "Symlinks and device nodes cannot be adopted.");
    }
    if (!policy.allowedPathPrefixes.some((prefix) => entry.relativePath.startsWith(prefix))) {
      throw new SandboxArtifactError("UNSAFE_PATH", "Artifact is outside configured output prefixes.");
    }
    if (!policy.allowedKinds.includes(entry.kind)) {
      throw new SandboxArtifactError("CONTENT_MISMATCH", `Artifact kind ${entry.kind} is not allowed.`);
    }
    if (entry.kind === "binary" && policy.allowOpaqueBinary !== true) {
      throw new SandboxArtifactError(
        "CONTENT_MISMATCH",
        "Opaque binary adoption requires an explicit non-renderable policy opt-in.",
      );
    }
    if (entry.byteSize > policy.maxFileBytes) {
      throw new SandboxArtifactError("LIMIT_EXCEEDED", "Artifact exceeds per-file policy.");
    }
    total += entry.byteSize;
    if (total > policy.maxTotalBytes) {
      throw new SandboxArtifactError("LIMIT_EXCEEDED", "Artifacts exceed total byte policy.");
    }
    assertMimeMatchesKind(entry);
  }
}

async function streamAndVerify(input: {
  chunks: AsyncIterable<Uint8Array>;
  entry: SandboxFileManifestEntry;
  upload: ArtifactStagingUpload;
}): Promise<void> {
  const hash = createHash("sha256");
  const head = new Uint8Array(64 * 1024);
  let headLength = 0;
  const tail = new Uint8Array(4 * 1024 * 1024);
  let tailLength = 0;
  let tailPosition = 0;
  const retainFull = ["json", "text", "csv", "vtt"].includes(input.entry.kind);
  const fullChunks: Uint8Array[] = [];
  let fullLength = 0;
  let byteSize = 0;
  for await (const chunk of input.chunks) {
    if (!(chunk instanceof Uint8Array)) {
      throw new SandboxArtifactError("CONTENT_MISMATCH", "Provider returned a non-byte chunk.");
    }
    byteSize += chunk.byteLength;
    if (byteSize > input.entry.byteSize) {
      throw new SandboxArtifactError("LIMIT_EXCEEDED", "Provider returned more bytes than declared.");
    }
    hash.update(chunk);
    if (headLength < head.byteLength) {
      const retained = chunk.subarray(0, Math.min(chunk.byteLength, head.byteLength - headLength));
      head.set(retained, headLength);
      headLength += retained.byteLength;
    }
    for (const byte of chunk) {
      tail[tailPosition] = byte;
      tailPosition = (tailPosition + 1) % tail.byteLength;
      tailLength = Math.min(tailLength + 1, tail.byteLength);
    }
    if (retainFull) {
      fullLength += chunk.byteLength;
      if (fullLength > 8 * 1024 * 1024) {
        throw new SandboxArtifactError(
          "LIMIT_EXCEEDED",
          "Text, CSV and JSON inspection is limited to 8 MiB.",
        );
      }
      fullChunks.push(chunk.slice());
    }
    await input.upload.write(chunk);
  }
  const digest = `sha256:${hash.digest("hex")}`;
  if (byteSize !== input.entry.byteSize || digest !== input.entry.digest) {
    throw new SandboxArtifactError(
      "DIGEST_MISMATCH",
      `Artifact bytes do not match the manifest for ${input.entry.relativePath}.`,
    );
  }
  inspectContent(
    input.entry,
    head.slice(0, headLength),
    materializeRing(tail, tailPosition, tailLength),
    retainFull ? concatChunks(fullChunks, fullLength) : undefined,
  );
}

function assertMimeMatchesKind(entry: SandboxFileManifestEntry): void {
  const expected = {
    pdf: ["application/pdf"],
    png: ["image/png"],
    jpeg: ["image/jpeg"],
    json: ["application/json"],
    text: ["text/plain", "text/markdown"],
    csv: ["text/csv"],
    pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    mp3: ["audio/mpeg"],
    wav: ["audio/wav", "audio/wave", "audio/x-wav"],
    mp4: ["video/mp4"],
    webp: ["image/webp"],
    vtt: ["text/vtt"],
    binary: ["application/octet-stream"],
  } satisfies Record<SandboxFileManifestEntry["kind"], readonly string[]>;
  if (!expected[entry.kind]?.includes(entry.mimeType)) {
    throw new SandboxArtifactError("CONTENT_MISMATCH", "Declared MIME type and kind disagree.");
  }
}

function inspectContent(
  entry: SandboxFileManifestEntry,
  head: Uint8Array,
  tail: Uint8Array,
  full?: Uint8Array,
): void {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
  let valid = true;
  try {
    switch (entry.kind) {
      case "pdf":
        valid =
          starts(0x25, 0x50, 0x44, 0x46, 0x2d) &&
          new TextDecoder().decode(tail).trimEnd().endsWith("%%EOF");
        break;
      case "png":
        valid =
          starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) &&
          tail.length >= 12 &&
          [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82].every(
            (byte, index) => tail[tail.length - 12 + index] === byte,
          );
        break;
      case "jpeg":
        valid = starts(0xff, 0xd8, 0xff) && tail.at(-2) === 0xff && tail.at(-1) === 0xd9;
        break;
      case "json":
        JSON.parse(decoder.decode(full));
        break;
      case "text":
      case "csv":
        decoder.decode(full);
        break;
      case "pptx":
        valid = validatePptxArchive(entry.byteSize, tail);
        break;
      case "mp3":
        valid =
          starts(0x49, 0x44, 0x33) ||
          (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
        break;
      case "wav":
        valid =
          starts(0x52, 0x49, 0x46, 0x46) &&
          new TextDecoder().decode(head.slice(8, 12)) === "WAVE";
        break;
      case "mp4":
        valid = head.length >= 12 && new TextDecoder().decode(head.slice(4, 8)) === "ftyp";
        break;
      case "webp":
        valid =
          starts(0x52, 0x49, 0x46, 0x46) &&
          new TextDecoder().decode(head.slice(8, 12)) === "WEBP";
        break;
      case "vtt":
        valid = decoder.decode(full).replace(/^\uFEFF/u, "").startsWith("WEBVTT");
        break;
      case "binary":
        valid =
          !starts(0x50, 0x4b, 0x03, 0x04) &&
          !starts(0x1f, 0x8b) &&
          !starts(0x7f, 0x45, 0x4c, 0x46) &&
          !starts(0x4d, 0x5a);
        break;
    }
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new SandboxArtifactError(
      "CONTENT_MISMATCH",
      `Artifact content does not match ${entry.kind}: ${entry.relativePath}.`,
    );
  }
}

function materializeRing(
  ring: Uint8Array,
  nextPosition: number,
  length: number,
): Uint8Array {
  if (length < ring.byteLength) return ring.slice(0, length);
  const result = new Uint8Array(length);
  const first = ring.subarray(nextPosition);
  result.set(first, 0);
  result.set(ring.subarray(0, nextPosition), first.byteLength);
  return result;
}

function concatChunks(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function validatePptxArchive(byteSize: number, tail: Uint8Array): boolean {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (readUint32(tail, offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return false;
  const commentLength = readUint16(tail, eocd + 20);
  if (eocd + 22 + commentLength !== tail.byteLength) return false;
  const entryCount = readUint16(tail, eocd + 10);
  const centralSize = readUint32(tail, eocd + 12);
  const centralOffset = readUint32(tail, eocd + 16);
  if (
    entryCount < 3 ||
    entryCount > 2_000 ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    return false;
  }
  const tailGlobalOffset = byteSize - tail.byteLength;
  const localCentralOffset = centralOffset - tailGlobalOffset;
  if (
    localCentralOffset < 0 ||
    centralSize > tail.byteLength ||
    localCentralOffset + centralSize > eocd
  ) {
    return false;
  }

  const names = new Set<string>();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let cursor = localCentralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(tail, cursor) !== 0x02014b50) return false;
    const flags = readUint16(tail, cursor + 8);
    const compressed = readUint32(tail, cursor + 20);
    const uncompressed = readUint32(tail, cursor + 24);
    const nameLength = readUint16(tail, cursor + 28);
    const extraLength = readUint16(tail, cursor + 30);
    const entryCommentLength = readUint16(tail, cursor + 32);
    const externalAttributes = readUint32(tail, cursor + 38);
    const next = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (
      next > eocd ||
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      (flags & 0x1) !== 0
    ) {
      return false;
    }
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0xf000) === 0xa000) return false;
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(
        tail.subarray(cursor + 46, cursor + 46 + nameLength),
      );
      assertSafeRelativePath(name.replace(/\/$/u, ""));
    } catch {
      return false;
    }
    if (name.toLowerCase().includes("vbaproject.bin")) return false;
    names.add(name);
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (
      totalUncompressed > 512 * 1024 * 1024 ||
      (totalCompressed === 0 ? totalUncompressed > 0 : totalUncompressed / totalCompressed > 100)
    ) {
      return false;
    }
    cursor = next;
  }
  return (
    cursor === localCentralOffset + centralSize &&
    cursor === eocd &&
    names.has("[Content_Types].xml") &&
    names.has("_rels/.rels") &&
    names.has("ppt/presentation.xml")
  );
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) return -1;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) return -1;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}
