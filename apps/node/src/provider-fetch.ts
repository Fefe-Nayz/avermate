import type {
  NodeProviderFetchPurpose,
  NodeProviderFetchRequest,
  NodeProviderFetchResponse,
  NodeWireBytes,
} from "@avermate/agent-contracts";
import type { NodeSecretStore } from "./secret-store";

// Base64 plus the signed control envelope must remain below the 256 KiB
// control-frame ceiling. Larger provider workloads use an object-transfer job.
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAXIMUM_DEADLINE_MS = 60_000;

function bytesFromWire(value: NodeWireBytes, maximumBytes: number) {
  if (value.encoding !== "base64url" || value.byteLength > maximumBytes) {
    throw new Error("NODE_PROVIDER_BODY_TOO_LARGE");
  }
  const bytes = Buffer.from(value.data, "base64url");
  if (bytes.byteLength !== value.byteLength) {
    throw new Error("NODE_PROVIDER_BODY_INVALID");
  }
  return new Uint8Array(bytes);
}

function wireFromBytes(bytes: Uint8Array): NodeWireBytes {
  return {
    encoding: "base64url",
    byteLength: bytes.byteLength,
    data: Buffer.from(bytes).toString("base64url"),
  };
}

function normalizedBase(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("NODE_PROVIDER_ENDPOINT_INVALID");
  }
  return url;
}

function targetFor(base: URL, purpose: NodeProviderFetchPurpose) {
  const suffix = purpose === "rerank" ? "rerank" : "embeddings";
  const path = base.pathname.replace(/\/+$/u, "");
  if (path.endsWith(`/${suffix}`)) return new URL(base);
  const target = new URL(base);
  target.pathname = `${path}/${suffix}`.replace(/^\/\//u, "/");
  return target;
}

async function boundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("NODE_PROVIDER_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel("response limit exceeded");
        throw new Error("NODE_PROVIDER_RESPONSE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export type NodeProviderRoute = {
  purpose: NodeProviderFetchPurpose;
  baseUrl: string;
  secretRef?: string;
};

/**
 * Node-private provider client. The signed configuration is the allowlist:
 * callers cannot turn the paired Node into a general-purpose network proxy.
 */
export class BoundedNodeProviderFetcher {
  readonly #routes = new Map<
    NodeProviderFetchPurpose,
    NodeProviderRoute & { target: URL }
  >();

  constructor(
    input: {
      routes: readonly NodeProviderRoute[];
      secrets: NodeSecretStore;
      fetch?: typeof globalThis.fetch;
      deadlineMs?: number;
    },
  ) {
    this.#secrets = input.secrets;
    this.#fetch = input.fetch ?? globalThis.fetch;
    this.#deadlineMs = Math.min(
      Math.max(input.deadlineMs ?? 20_000, 1),
      MAXIMUM_DEADLINE_MS,
    );
    for (const route of input.routes) {
      if (this.#routes.has(route.purpose)) {
        throw new Error("NODE_PROVIDER_ROUTE_DUPLICATE");
      }
      const base = normalizedBase(route.baseUrl);
      this.#routes.set(route.purpose, {
        ...route,
        target: targetFor(base, route.purpose),
      });
    }
  }

  readonly #secrets: NodeSecretStore;
  readonly #fetch: typeof globalThis.fetch;
  readonly #deadlineMs: number;

  async fetch(request: NodeProviderFetchRequest, signal?: AbortSignal) {
    if (request.method !== "POST") {
      throw new Error("NODE_PROVIDER_METHOD_DENIED");
    }
    const route = this.#routes.get(request.purpose);
    if (!route) throw new Error("NODE_PROVIDER_ROUTE_NOT_CONFIGURED");
    const requested = normalizedBase(request.url);
    if (requested.href !== route.target.href) {
      throw new Error("NODE_PROVIDER_ENDPOINT_DENIED");
    }
    const contentType = request.headers["content-type"]?.toLowerCase();
    const accept = request.headers.accept?.toLowerCase();
    const unexpectedHeaders = Object.keys(request.headers).filter(
      (header) => !["content-type", "accept"].includes(header.toLowerCase()),
    );
    if (
      contentType !== "application/json" ||
      (accept && accept !== "application/json") ||
      unexpectedHeaders.length > 0
    ) {
      throw new Error("NODE_PROVIDER_HEADERS_DENIED");
    }
    const body = bytesFromWire(request.body, MAX_REQUEST_BYTES);
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (route.secretRef) {
      headers.authorization = `Bearer ${await this.#secrets.read(route.secretRef)}`;
    }
    const providerSignal = AbortSignal.any([
      signal ?? new AbortController().signal,
      AbortSignal.timeout(this.#deadlineMs),
    ]);
    const response = await this.#fetch(route.target, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: providerSignal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("NODE_PROVIDER_REDIRECT_DENIED");
    }
    const responseBody = await boundedBody(response);
    const output: NodeProviderFetchResponse = {
      status: response.status,
      headers: {
        ...(response.headers.get("content-type")
          ? { "content-type": response.headers.get("content-type")! }
          : {}),
      },
      body: wireFromBytes(responseBody),
    };
    return output;
  }
}
