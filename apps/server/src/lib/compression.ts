import type { MiddlewareHandler } from "hono";
import { brotliCompress, constants, gzip } from "node:zlib";

export const RPC_COMPRESSION_THRESHOLD = 1024;

type SupportedEncoding = "br" | "gzip";

const JSON_CONTENT_TYPE = /^\s*application\/(?:json|[^;\s]+\+json)(?:[;\s]|$)/i;
const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i;
const ENCODING_PRIORITY: readonly SupportedEncoding[] = ["br", "gzip"];

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }
  if (current.trim() === "*") return;

  const values = current.split(",").map((item) => item.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}

function qualityValues(header: string): Map<string, number> {
  const values = new Map<string, number>();

  for (const item of header.split(",")) {
    const [rawName, ...parameters] = item.split(";");
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;

    let quality = 1;
    const qualityParameter = parameters.find((parameter) =>
      /^\s*q\s*=/i.test(parameter),
    );
    if (qualityParameter) {
      const parsed = Number(qualityParameter.split("=", 2)[1]?.trim());
      quality =
        Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    }

    values.set(name, Math.max(values.get(name) ?? 0, quality));
  }

  return values;
}

export function negotiateCompression(
  acceptEncoding: string | undefined,
): SupportedEncoding | undefined {
  if (!acceptEncoding?.trim()) return undefined;

  const values = qualityValues(acceptEncoding);
  const wildcard = values.get("*") ?? 0;
  let selected: { encoding: SupportedEncoding; quality: number } | undefined;

  for (const encoding of ENCODING_PRIORITY) {
    const quality = values.has(encoding)
      ? (values.get(encoding) ?? 0)
      : wildcard;
    if (quality <= 0) continue;
    if (!selected || quality > selected.quality) {
      selected = { encoding, quality };
    }
  }

  return selected?.encoding;
}

function gzipBody(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    gzip(input, { level: 6 }, (error, output) => {
      if (error) reject(error);
      else resolve(Uint8Array.from(output));
    });
  });
}

function brotliBody(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    brotliCompress(
      input,
      {
        params: {
          // Quality 4 is the usual latency/size compromise for dynamic HTTP.
          [constants.BROTLI_PARAM_QUALITY]: 4,
        },
      },
      (error, output) => {
        if (error) reject(error);
        else resolve(Uint8Array.from(output));
      },
    );
  });
}

/**
 * Compress buffered oRPC JSON responses after their real byte size is known.
 *
 * Hono and oRPC's built-ins intentionally stream bodies and therefore cannot
 * apply their threshold when oRPC omits Content-Length. This narrow middleware
 * buffers JSON only; SSE/event iterators and the separate MCP route stay
 * untouched.
 */
export function compressRpcJson(
  threshold = RPC_COMPRESSION_THRESHOLD,
): MiddlewareHandler {
  return async (context, next) => {
    await next();

    const response = context.res;
    const contentType = response.headers.get("Content-Type");
    if (
      context.req.method === "HEAD" ||
      response.body === null ||
      response.status === 204 ||
      response.status === 205 ||
      response.status === 206 ||
      response.status === 304 ||
      !contentType ||
      !JSON_CONTENT_TYPE.test(contentType) ||
      response.headers.has("Transfer-Encoding") ||
      NO_TRANSFORM.test(response.headers.get("Cache-Control") ?? "")
    ) {
      return;
    }

    appendVary(response.headers, "Accept-Encoding");

    // Respect an upstream/handler encoding and never compress the same bytes twice.
    if (response.headers.has("Content-Encoding")) return;

    const declaredLength = Number(response.headers.get("Content-Length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > 0 &&
      declaredLength < threshold
    ) {
      return;
    }

    const encoding = negotiateCompression(
      context.req.header("Accept-Encoding"),
    );
    if (!encoding) return;

    const source = new Uint8Array(await response.arrayBuffer());
    if (source.byteLength < threshold) {
      const headers = new Headers(response.headers);
      headers.set("Content-Length", String(source.byteLength));
      context.res = new Response(source, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      return;
    }

    const compressed =
      encoding === "br" ? await brotliBody(source) : await gzipBody(source);
    const headers = new Headers(response.headers);
    headers.set("Content-Encoding", encoding);
    headers.set("Content-Length", String(compressed.byteLength));

    const etag = headers.get("ETag");
    if (etag && !etag.startsWith("W/")) headers.set("ETag", `W/${etag}`);

    context.res = new Response(compressed, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
