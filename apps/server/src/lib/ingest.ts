/// <reference path="../types/turndown.d.ts" />

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export const RESPONSE_MAX_BYTES = 5 * 1024 * 1024;
export const MARKDOWN_MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MIN_ARTICLE_TEXT_CHARS = 80;
const SOURCE_URL_MAX_CHARS = 4_096;

export class IngestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IngestError";
  }
}

export interface DnsAddress {
  address: string;
  family: number;
}

export type DnsResolver = (hostname: string) => Promise<readonly DnsAddress[]>;
export type IngestFetcher = (
  input: string | URL | Request,
  init?: BunFetchRequestInit,
) => Promise<Response>;

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const bytes = address.split(".").map(Number);
  return bytes.length === 4 && bytes.every((byte) => byte >= 0 && byte <= 255)
    ? bytes
    : null;
}

function ipv6Bytes(address: string): number[] | null {
  const normalized = address
    .replace(/^\[|\]$/g, "")
    .split("%", 1)[0]
    ?.toLowerCase();
  if (!normalized || isIP(normalized) !== 6) return null;

  const expandSide = (side: string): number[] => {
    if (!side) return [];
    const groups = side.split(":");
    const output: number[] = [];
    for (const group of groups) {
      const ipv4 = ipv4Bytes(group);
      if (ipv4) {
        output.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
      } else {
        output.push(Number.parseInt(group, 16));
      }
    }
    return output;
  };

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = expandSide(halves[0] ?? "");
  const right = expandSide(halves[1] ?? "");
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups =
    halves.length === 2
      ? [...left, ...Array.from({ length: missing }, () => 0), ...right]
      : left;
  if (
    (missing < 1 && halves.length === 2) ||
    groups.length !== 8 ||
    groups.some(
      (group) => !Number.isInteger(group) || group < 0 || group > 0xffff,
    )
  ) {
    return null;
  }
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function isNonPublicIpv4(address: string): boolean {
  const bytes = ipv4Bytes(address);
  if (!bytes) return true;
  const [a, b, c] = bytes;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

function isNonPublicIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const uniqueLocal = (bytes[0]! & 0xfe) === 0xfc;
  const linkLocal = bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80;
  const siteLocal = bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0;
  const multicast = bytes[0] === 0xff;
  const documentation =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8;
  const mappedIpv4 =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  const globalUnicast = (bytes[0]! & 0xe0) === 0x20;
  const ianaSpecial2001 =
    bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2]! & 0xfe) === 0;
  const documentation2001 =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8;
  const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
  const formerSixBone = bytes[0] === 0x3f && bytes[1] === 0xfe;
  const documentation3fff = bytes[0] === 0x3f && bytes[1] === 0xff;
  return (
    allZero ||
    loopback ||
    uniqueLocal ||
    linkLocal ||
    siteLocal ||
    multicast ||
    documentation ||
    !globalUnicast ||
    ianaSpecial2001 ||
    documentation2001 ||
    sixToFour ||
    formerSixBone ||
    documentation3fff ||
    (mappedIpv4 && isNonPublicIpv4(bytes.slice(12).map(String).join(".")))
  );
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, "").split("%", 1)[0] ?? "");
  if (family === 4) return !isNonPublicIpv4(address);
  if (family === 6) return !isNonPublicIpv6(address);
  return false;
}

async function defaultResolve(hostname: string): Promise<DnsAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) {
    throw new IngestError("The source page timed out", true);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new IngestError("The source page timed out", true));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

interface PublicHttpTarget {
  url: URL;
  addresses: readonly DnsAddress[];
}

/**
 * Validate the part of the source URL that must be rejected before it is ever
 * persisted. Network address checks still happen in `fetchArticle`, where DNS
 * can be pinned for the actual request.
 */
export function parseHttpSourceUrl(value: string | URL): URL {
  if (value.toString().length > SOURCE_URL_MAX_CHARS) {
    throw new IngestError("The source URL is too long", false);
  }

  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    throw new IngestError("The source URL is invalid", false);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IngestError(
      "Only public HTTP and HTTPS sources are supported",
      false,
    );
  }
  if (url.username || url.password) {
    throw new IngestError("Source URLs cannot contain credentials", false);
  }
  return url;
}

async function publicHttpTarget(
  value: string | URL,
  options: { resolve?: DnsResolver; signal?: AbortSignal } = {},
): Promise<PublicHttpTarget> {
  const url = parseHttpSourceUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname.toLowerCase() === "localhost" ||
    hostname.toLowerCase().endsWith(".localhost")
  ) {
    throw new IngestError(
      "Private or local source addresses are not allowed",
      false,
    );
  }

  let addresses: readonly DnsAddress[];
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await awaitWithAbort(
        (options.resolve ?? defaultResolve)(hostname),
        options.signal,
      );
    } catch {
      if (options.signal?.aborted) {
        throw new IngestError("The source page timed out", true);
      }
      throw new IngestError("The source host could not be resolved", true);
    }
  }
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicIpAddress(entry.address))
  ) {
    throw new IngestError(
      "Private or local source addresses are not allowed",
      false,
    );
  }
  return { url, addresses };
}

export async function assertPublicHttpUrl(
  value: string | URL,
  options: { resolve?: DnsResolver; signal?: AbortSignal } = {},
): Promise<URL> {
  return (await publicHttpTarget(value, options)).url;
}

function pinnedUrl(target: PublicHttpTarget, address: DnsAddress) {
  const url = new URL(target.url);
  url.hostname =
    address.family === 6 ? `[${address.address}]` : address.address;
  return url;
}

function responseContentType(response: Response): string {
  return (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
}

async function readBoundedBody(
  response: Response,
  controller: AbortController,
  options: {
    maxBytes?: number;
    tooLargeMessage?: string;
  } = {},
): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? RESPONSE_MAX_BYTES;
  const tooLargeMessage =
    options.tooLargeMessage ?? "The source page is larger than 5 MiB";
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    controller.abort("Source body exceeded its byte budget");
    throw new IngestError(tooLargeMessage, false);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel("Source body exceeded its byte budget");
      controller.abort("Source body exceeded its byte budget");
      throw new IngestError(tooLargeMessage, false);
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export interface FetchedArticle {
  body: Uint8Array;
  html: string | null;
  finalUrl: string;
  contentType: string;
}

export async function fetchArticle(
  value: string | URL,
  options: {
    fetch?: IngestFetcher;
    resolve?: DnsResolver;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<FetchedArticle> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("Source fetch timed out"),
    options.timeoutMs ?? FETCH_TIMEOUT_MS,
  );
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();

  try {
    let current = await publicHttpTarget(value, {
      resolve: options.resolve,
      signal: controller.signal,
    });
    const fetcher = options.fetch ?? fetch;
    for (
      let redirectCount = 0;
      redirectCount <= MAX_REDIRECTS;
      redirectCount += 1
    ) {
      let response: Response | null = null;
      let lastFetchError: unknown;
      for (const address of current.addresses) {
        try {
          const originalHostname = current.url.hostname.replace(/^\[|\]$/g, "");
          response = await fetcher(pinnedUrl(current, address), {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            keepalive: false,
            headers: {
              accept: "text/html,application/xhtml+xml,application/pdf;q=0.9",
              host: current.url.host,
              "user-agent": "avermate-ingest/1.0",
            },
            tls:
              current.url.protocol === "https:" && !isIP(originalHostname)
                ? { serverName: originalHostname }
                : undefined,
          });
          break;
        } catch (error) {
          lastFetchError = error;
          if (controller.signal.aborted) break;
        }
      }
      if (!response) {
        if (options.signal?.aborted) throw lastFetchError;
        const message = controller.signal.aborted
          ? "The source page timed out"
          : "The source page is inaccessible";
        throw new IngestError(message, true, { cause: lastFetchError });
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          throw new IngestError(
            "The source returned an invalid redirect",
            false,
          );
        }
        if (redirectCount === MAX_REDIRECTS) {
          throw new IngestError("The source redirected too many times", false);
        }
        current = await publicHttpTarget(new URL(location, current.url), {
          resolve: options.resolve,
          signal: controller.signal,
        });
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        throw new IngestError(
          `The source page returned HTTP ${response.status}`,
          retryable,
        );
      }

      const contentType = responseContentType(response);
      const body = await readBoundedBody(response, controller);
      const isHtml =
        contentType === "text/html" ||
        contentType === "application/xhtml+xml" ||
        (!contentType && body.length > 0);
      return {
        body,
        html: isHtml ? new TextDecoder().decode(body) : null,
        finalUrl: current.url.toString(),
        contentType,
      };
    }
    throw new IngestError("The source redirected too many times", false);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export interface ExtractedMarkdown {
  markdown: string;
  title: string;
  byline: string | null;
  site?: string | null;
  publishedAt?: string | null;
  wordCount?: number;
  truncated?: boolean;
  textLength?: number;
}

function truncateCodePoints(value: string, maxLength: number) {
  const points = Array.from(value.trim());
  return points.length <= maxLength
    ? points.join("")
    : points.slice(0, maxLength).join("");
}

const TRACKING_QUERY_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
]);

function cleanHttpUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        TRACKING_QUERY_PARAMETERS.has(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function countWords(value: string) {
  const words = value.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu);
  return words?.length ?? 0;
}

function truncateUtf8(value: string, maxBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return { value, truncated: false };
  }
  const points = Array.from(value);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      encoder.encode(points.slice(0, middle).join("")).byteLength <= maxBytes
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { value: points.slice(0, low).join("").trimEnd(), truncated: true };
}

export interface MarkdownDocumentMetadata {
  title: string;
  source: string;
  fetchedAt: Date;
  site?: string | null;
  author?: string | null;
  publishedAt?: string | null;
}

function frontMatterScalar(value: string) {
  // JSON strings are valid YAML double-quoted scalars and cannot terminate the
  // front matter, even when publisher metadata contains newlines or `---`.
  return JSON.stringify(value);
}

export function buildMarkdownDocument(
  rawContent: string,
  metadata: MarkdownDocumentMetadata,
) {
  const content = normalizeExtractedText(rawContent);
  // Leave a conservative budget for front matter and persisted artifact meta.
  const marker = "\n\n> Content truncated at Avermate's 2 MiB import limit.";
  const fitted = truncateUtf8(
    content,
    MARKDOWN_MAX_BYTES -
      16 * 1024 -
      new TextEncoder().encode(marker).byteLength,
  );
  const body = `${fitted.value}${fitted.truncated ? marker : ""}`;
  const wordCount = countWords(fitted.value);
  const lines = [
    "---",
    `title: ${frontMatterScalar(truncateCodePoints(metadata.title, 160))}`,
    `source: ${frontMatterScalar(metadata.source)}`,
    `fetched: ${frontMatterScalar(metadata.fetchedAt.toISOString())}`,
  ];
  if (metadata.site) {
    lines.push(
      `site: ${frontMatterScalar(truncateCodePoints(metadata.site, 160))}`,
    );
  }
  if (metadata.author) {
    lines.push(
      `author: ${frontMatterScalar(truncateCodePoints(metadata.author, 240))}`,
    );
  }
  if (metadata.publishedAt) {
    lines.push(
      `published: ${frontMatterScalar(truncateCodePoints(metadata.publishedAt, 80))}`,
    );
  }
  lines.push(`words: ${wordCount}`, `truncated: ${fitted.truncated}`, "---");
  return {
    markdown: `${lines.join("\n")}\n\n${body}`,
    wordCount,
    truncated: fitted.truncated,
  };
}

function sanitizeDocumentUrls(document: Document, finalUrl: string) {
  for (const anchor of document.querySelectorAll("a[href]")) {
    const value = anchor.getAttribute("href");
    if (!value || value.startsWith("#")) continue;
    if (/^mailto:/i.test(value)) continue;
    const cleaned = cleanHttpUrl(value, finalUrl);
    if (cleaned) anchor.setAttribute("href", cleaned);
    else anchor.removeAttribute("href");
  }
  // Imported Markdown is rendered in the user's browser. Keeping remote image
  // URLs here would turn opening a material into an unvalidated browser fetch,
  // leaking the user's IP and allowing requests to LAN hosts. Until images are
  // fetched server-side, validated, and stored privately, preserve only a
  // bounded textual description and discard every resource-loading element.
  for (const image of document.querySelectorAll("img")) {
    const width = Number.parseInt(image.getAttribute("width") ?? "", 10);
    const height = Number.parseInt(image.getAttribute("height") ?? "", 10);
    if ((width > 0 && width <= 1) || (height > 0 && height <= 1)) {
      image.remove();
      continue;
    }
    const alt = truncateCodePoints(image.getAttribute("alt") ?? "", 240);
    image.replaceWith(document.createTextNode(alt ? `Image: ${alt}` : ""));
  }
  for (const resource of document.querySelectorAll(
    "source, picture source, svg, input[type='image']",
  )) {
    resource.remove();
  }
  for (const media of document.querySelectorAll("video[poster]")) {
    media.removeAttribute("poster");
  }
}

export function extractMarkdown(
  html: string,
  finalUrl: string,
  options: { now?: Date } = {},
): ExtractedMarkdown {
  const { document } = parseHTML(html);
  const base = document.createElement("base");
  base.setAttribute("href", finalUrl);
  document.head?.prepend(base);
  sanitizeDocumentUrls(document as unknown as Document, finalUrl);
  const article = new Readability(document as unknown as Document).parse();
  const textContent = normalizeExtractedText(article?.textContent ?? "");
  if (!article?.content || textContent.length < MIN_ARTICLE_TEXT_CHARS) {
    throw new IngestError("The page has no extractable article content", false);
  }

  const converter = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  converter.use(gfm);
  const capturedAt = options.now ?? new Date();
  const content = converter.turndown(article.content).trim();
  const rawTitle = article.title?.trim() || new URL(finalUrl).hostname;
  const rawByline = article.byline?.trim() || null;
  const rawSite = article.siteName?.trim() || null;
  const rawPublishedAt = article.publishedTime?.trim() || null;
  const title = truncateCodePoints(rawTitle, 160);
  const byline = rawByline ? truncateCodePoints(rawByline, 240) || null : null;
  const site = rawSite ? truncateCodePoints(rawSite, 160) || null : null;
  const publishedAt = rawPublishedAt
    ? truncateCodePoints(rawPublishedAt, 80) || null
    : null;
  const built = buildMarkdownDocument(content, {
    title,
    source: finalUrl,
    fetchedAt: capturedAt,
    site,
    author: byline,
    publishedAt,
  });
  const extracted = {
    ...built,
    title,
    byline,
    site,
    publishedAt,
    textLength: textContent.length,
  };
  return extracted;
}
