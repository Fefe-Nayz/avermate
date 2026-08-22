import type { SourceLocatorV1 } from "@avermate/agent-contracts";
import sharp from "sharp";
import { fetchArticle } from "../lib/ingest";
import { storageEnabled } from "../lib/storage";
import type { ExtractedBlock } from "./adapters";
import { sha256 } from "./values";

const MAX_INLINE_ASSETS = 32;
const MAX_DATA_URI_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

export type PendingContentAsset = {
  bytes: Uint8Array;
  mimeType: "image/webp";
  contentHash: string;
  role: "inline-image";
  locator: SourceLocatorV1;
  altText: string | null;
};

type AssetFetcher = typeof fetchArticle;

function boundedAlt(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? [...trimmed].slice(0, 240).join("") : null;
}

function dataUri(value: string) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match?.[1] || !match[2]) return null;
  const bytes = Uint8Array.from(
    Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
  );
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DATA_URI_BYTES)
    return null;
  return { bytes, contentType: match[1].toLowerCase() };
}

async function sourceBytes(value: string, fetcher: AssetFetcher) {
  const inline = dataUri(value);
  if (inline) return inline;
  if (!/^https?:\/\//i.test(value)) return null;
  const fetched = await fetcher(value, { timeoutMs: 12_000 });
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(fetched.contentType)
  ) {
    return null;
  }
  return { bytes: fetched.body, contentType: fetched.contentType };
}

async function normalizeImage(bytes: Uint8Array) {
  const pipeline = sharp(bytes, {
    animated: false,
    failOn: "warning",
    limitInputPixels: MAX_IMAGE_PIXELS,
  });
  const metadata = await pipeline.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
    !["png", "jpeg", "webp"].includes(metadata.format ?? "")
  ) {
    throw new Error("Inline image failed the raster safety policy");
  }
  const output = await pipeline
    .rotate()
    .resize({
      width: 4_096,
      height: 4_096,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 90, effort: 4 })
    .toBuffer();
  return new Uint8Array(output);
}

// Markdown destinations emitted by Avermate's extractors are URL/data tokens;
// angle brackets are accepted, while whitespace-heavy CommonMark destinations
// are deliberately reduced to text rather than interpreted ambiguously.
const markdownImage =
  /!\[([^\]\r\n]*)\]\((?:<([^>\r\n]+)>|([^\s)\r\n]+))(?:\s+["'][^"'\r\n]*["'])?\)/g;

export async function captureInlineAssets(
  blocks: readonly ExtractedBlock[],
  options: { fetchArticle?: AssetFetcher; enabled?: boolean } = {},
) {
  const assets: PendingContentAsset[] = [];
  const cached = new Map<string, Promise<Uint8Array | null>>();
  const fetcher = options.fetchArticle ?? fetchArticle;
  const enabled = options.enabled ?? storageEnabled();
  const capture = (source: string) => {
    const existing = cached.get(source);
    if (existing) return existing;
    const pending = (async () => {
      if (!enabled) return null;
      try {
        const input = await sourceBytes(source, fetcher);
        return input ? await normalizeImage(input.bytes) : null;
      } catch {
        return null;
      }
    })();
    cached.set(source, pending);
    return pending;
  };

  const transformed: ExtractedBlock[] = [];
  for (const block of blocks) {
    let cursor = 0;
    let text = "";
    for (const match of block.text.matchAll(markdownImage)) {
      const start = match.index ?? 0;
      text += block.text.slice(cursor, start);
      cursor = start + match[0].length;
      const alt = boundedAlt(match[1] ?? "");
      const source = match[2] ?? match[3] ?? "";
      if (assets.length >= MAX_INLINE_ASSETS) {
        text += alt ? `[Image: ${alt}]` : "[Image non capturée]";
        continue;
      }
      const bytes = await capture(source);
      if (!bytes) {
        // Never leave a hotlink in indexed Markdown, even when capture fails.
        text += alt ? `[Image: ${alt}]` : "[Image non disponible]";
        continue;
      }
      const contentHash = sha256(bytes);
      text += `![${alt ?? "Image"}](asset://${contentHash})`;
      assets.push({
        bytes,
        mimeType: "image/webp",
        contentHash,
        role: "inline-image",
        locator: block.locator,
        altText: alt,
      });
    }
    text += block.text.slice(cursor);
    transformed.push({ ...block, text });
  }
  return { blocks: transformed, assets };
}
