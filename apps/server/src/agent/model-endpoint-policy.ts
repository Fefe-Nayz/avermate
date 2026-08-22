import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export type ModelEndpointPlacement = "hosted-core" | "node" | "full-self-host";
export type ModelLookupAddress = { address: string; family: number };
export type ModelLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ModelLookupAddress[]>;
export type ModelTransport = (
  url: URL,
  init: RequestInit,
  addresses: readonly ModelLookupAddress[],
  connectTimeoutMs: number,
) => Promise<Response>;

export type ModelEndpointPolicy = {
  placement: ModelEndpointPlacement;
  allowedOrigins: readonly string[];
  lookup?: ModelLookup;
};

export type BoundModelCredential = {
  origin: string;
  headerName: string;
  value: string;
};

export type SafeModelRequestOptions = {
  policy: ModelEndpointPolicy;
  credential?: BoundModelCredential;
  signal?: AbortSignal;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  maxRedirects?: number;
  maxResponseBytes?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  totalTimeoutMs?: number;
  transport?: ModelTransport;
};

const sensitiveRequestHeader =
  /^(authorization|cookie|proxy-authorization|x-api-key|api-key)$/i;

export class ModelEndpointPolicyError extends Error {
  constructor(
    readonly code:
      | "invalid_url"
      | "origin_not_allowed"
      | "unsafe_address"
      | "dns_failed"
      | "redirect_rejected"
      | "response_too_large"
      | "timeout"
      | "transport_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelEndpointPolicyError";
  }
}

const alwaysBlockedV4 = new BlockList();
const privateV4 = new BlockList();
const alwaysBlockedV6 = new BlockList();
const privateV6 = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  alwaysBlockedV4.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["10.0.0.0", 8],
  ["127.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  privateV4.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fec0::", 10],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  alwaysBlockedV6.addSubnet(address, prefix, "ipv6");
}
privateV6.addSubnet("::1", 128, "ipv6");
privateV6.addSubnet("fc00::", 7, "ipv6");

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function mappedIpv4(address: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (dotted?.[1]) return dotted[1];
  const hexadecimal = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i.exec(address);
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1]!, 16);
  const low = Number.parseInt(hexadecimal[2]!, 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function addressAllowed(
  address: string,
  placement: ModelEndpointPlacement,
): boolean {
  const normalized = stripIpv6Brackets(address);
  const mapped = mappedIpv4(normalized);
  if (mapped) return addressAllowed(mapped, placement);
  const family = isIP(normalized);
  if (family === 4) {
    if (alwaysBlockedV4.check(normalized, "ipv4")) return false;
    return (
      !privateV4.check(normalized, "ipv4") || placement !== "hosted-core"
    );
  }
  if (family === 6) {
    if (alwaysBlockedV6.check(normalized, "ipv6")) return false;
    return (
      !privateV6.check(normalized, "ipv6") || placement !== "hosted-core"
    );
  }
  return false;
}

function hostnameLooksLocal(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa")
  );
}

function normalizeAllowedOrigins(policy: ModelEndpointPolicy): Set<string> {
  const origins = new Set<string>();
  for (const value of policy.allowedOrigins) {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new ModelEndpointPolicyError(
        "invalid_url",
        "A configured model origin is invalid",
        { cause: error },
      );
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new ModelEndpointPolicyError(
        "invalid_url",
        "Model origins cannot contain credentials, paths, queries or fragments",
      );
    }
    origins.add(url.origin);
  }
  return origins;
}

export async function validateModelEndpoint(
  input: string | URL,
  policy: ModelEndpointPolicy,
): Promise<{ url: URL; addresses: ModelLookupAddress[] }> {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input) : new URL(input);
  } catch (error) {
    throw new ModelEndpointPolicyError("invalid_url", "Model URL is invalid", {
      cause: error,
    });
  }
  const localPlacement = policy.placement !== "hosted-core";
  if (
    url.username ||
    url.password ||
    !url.hostname ||
    (url.protocol !== "https:" && !(localPlacement && url.protocol === "http:"))
  ) {
    throw new ModelEndpointPolicyError(
      "invalid_url",
      "Model URL violates the placement transport policy",
    );
  }
  if (!localPlacement && hostnameLooksLocal(url.hostname)) {
    throw new ModelEndpointPolicyError(
      "unsafe_address",
      "Hosted model endpoints must be public",
    );
  }
  if (!normalizeAllowedOrigins(policy).has(url.origin)) {
    throw new ModelEndpointPolicyError(
      "origin_not_allowed",
      "Model origin is not approved for this placement",
    );
  }

  const hostname = stripIpv6Brackets(url.hostname);
  const family = isIP(hostname);
  if (family) {
    if (!addressAllowed(hostname, policy.placement)) {
      throw new ModelEndpointPolicyError(
        "unsafe_address",
        "Model endpoint targets a forbidden network address",
      );
    }
    return { url, addresses: [{ address: hostname, family }] };
  }

  let addresses: ModelLookupAddress[];
  try {
    addresses = await (policy.lookup ?? (dnsLookup as ModelLookup))(hostname, {
      all: true,
      verbatim: true,
    });
  } catch (error) {
    throw new ModelEndpointPolicyError(
      "dns_failed",
      "Model endpoint DNS resolution failed",
      { cause: error },
    );
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !addressAllowed(address, policy.placement))
  ) {
    throw new ModelEndpointPolicyError(
      "unsafe_address",
      "Model endpoint DNS includes a forbidden network address",
    );
  }
  return {
    url,
    addresses: addresses.map(({ address, family: addressFamily }) => ({
      address: stripIpv6Brackets(address),
      family: addressFamily === 6 ? 6 : 4,
    })),
  };
}

export function createPinnedModelLookup(
  addresses: readonly ModelLookupAddress[],
  placement: ModelEndpointPlacement,
): LookupFunction {
  const pinned = addresses.map(({ address, family }) => ({
    address: stripIpv6Brackets(address),
    family: family === 6 ? 6 : 4,
  }));
  if (
    pinned.length === 0 ||
    pinned.some(({ address }) => !addressAllowed(address, placement))
  ) {
    throw new ModelEndpointPolicyError(
      "unsafe_address",
      "Pinned model transport received an unsafe address",
    );
  }
  return (_hostname, options, callback) => {
    if (options.all) callback(null, pinned);
    else callback(null, pinned[0]!.address, pinned[0]!.family);
  };
}

async function requestBody(body: BodyInit | null | undefined) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new ModelEndpointPolicyError(
    "invalid_url",
    "Unsupported model request body type",
  );
}

function responseHeaders(response: import("node:http").IncomingMessage) {
  const headers = new Headers();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name && value !== undefined) headers.append(name, value);
  }
  return headers;
}

async function pinnedModelTransport(
  url: URL,
  init: RequestInit,
  addresses: readonly ModelLookupAddress[],
  connectTimeoutMs: number,
  placement: ModelEndpointPlacement,
): Promise<Response> {
  const body = await requestBody(init.body);
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const requestFactory = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = requestFactory(
      url,
      {
        method: init.method,
        headers,
        lookup: createPinnedModelLookup(addresses, placement),
        signal: init.signal ?? undefined,
        timeout: connectTimeoutMs,
      },
      (incoming) => {
        request.setTimeout(0);
        const stream = Readable.toWeb(
          incoming,
        ) as unknown as ReadableStream<Uint8Array>;
        resolve(
          new Response(stream, {
            status: incoming.statusCode ?? 502,
            headers: responseHeaders(incoming),
          }),
        );
      },
    );
    request.once("timeout", () => {
      request.destroy(
        new ModelEndpointPolicyError("timeout", "Model connection timed out"),
      );
    });
    request.once("error", reject);
    if (body === undefined) request.end();
    else request.end(body);
  });
}

function totalSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new ModelEndpointPolicyError("timeout", "Model request timed out"),
      ),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  readTimeoutMs: number,
  signal: AbortSignal,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    throw new ModelEndpointPolicyError(
      "response_too_large",
      "Model response exceeds the byte limit",
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = reader.read();
      const chunk = await Promise.race([
        read,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ModelEndpointPolicyError(
                  "timeout",
                  "Model response read timed out",
                ),
              ),
            readTimeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        throw new ModelEndpointPolicyError(
          "response_too_large",
          "Model response exceeds the byte limit",
        );
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
    return output + decoder.decode();
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function redirectMethod(status: number, method: string): string {
  if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
    return "GET";
  }
  return method;
}

function requestHeadersForOrigin(
  source: HeadersInit | undefined,
  credential: BoundModelCredential | undefined,
  origin: string,
): Headers {
  const headers = new Headers(source);
  for (const name of headers.keys()) {
    if (sensitiveRequestHeader.test(name)) {
      throw new ModelEndpointPolicyError(
        "invalid_url",
        "Sensitive model headers must use an origin-bound credential",
      );
    }
  }
  if (!credential) return headers;

  let credentialOrigin: string;
  try {
    credentialOrigin = new URL(credential.origin).origin;
  } catch (error) {
    throw new ModelEndpointPolicyError(
      "invalid_url",
      "Model credential origin is invalid",
      { cause: error },
    );
  }
  if (origin !== credentialOrigin) {
    throw new ModelEndpointPolicyError(
      "redirect_rejected",
      "Model credential is bound to a different origin",
    );
  }
  headers.set(credential.headerName, credential.value);
  return headers;
}

function boundedModelResponse(
  response: Response,
  bounded: ReturnType<typeof totalSignal>,
  maxBytes: number,
  readTimeoutMs: number,
): Response {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    bounded.dispose();
    throw new ModelEndpointPolicyError(
      "response_too_large",
      "Model response exceeds the byte limit",
    );
  }
  if (!response.body) {
    bounded.dispose();
    return response;
  }

  const reader = response.body.getReader();
  let bytes = 0;
  let finished = false;
  const finish = () => {
    if (finished) return false;
    finished = true;
    bounded.signal.removeEventListener("abort", onAbort);
    bounded.dispose();
    reader.releaseLock();
    return true;
  };
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const onAbort = () => {
    if (finished) return;
    const reason = bounded.signal.reason;
    void reader.cancel(reason).catch(() => undefined);
    if (finish()) streamController?.error(reason);
  };
  bounded.signal.addEventListener("abort", onAbort, { once: true });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    async pull(controller) {
      if (finished) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new ModelEndpointPolicyError(
                    "timeout",
                    "Model response read timed out",
                  ),
                ),
              readTimeoutMs,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        if (finished) return;
        if (chunk.done) {
          finish();
          controller.close();
          return;
        }
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          throw new ModelEndpointPolicyError(
            "response_too_large",
            "Model response exceeds the byte limit",
          );
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        void reader.cancel(error).catch(() => undefined);
        if (finish()) controller.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      await reader.cancel(reason).catch(() => undefined);
      finish();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function safeModelFetchResponse(
  input: string | URL,
  options: SafeModelRequestOptions,
): Promise<Response> {
  const bounded = totalSignal(options.signal, options.totalTimeoutMs ?? 30_000);
  const maxRedirects = options.maxRedirects ?? 2;
  const maxBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  const readTimeoutMs = options.readTimeoutMs ?? 10_000;
  let current: URL;
  try {
    current = input instanceof URL ? new URL(input) : new URL(input);
  } catch (error) {
    bounded.dispose();
    throw new ModelEndpointPolicyError("invalid_url", "Model URL is invalid", {
      cause: error,
    });
  }
  const initialOrigin = current.origin;
  let method = (options.method ?? "POST").toUpperCase();
  let body = options.body;

  try {
    for (let redirects = 0; ; redirects += 1) {
      if (bounded.signal.aborted) throw bounded.signal.reason;
      const validated = await validateModelEndpoint(current, options.policy);
      const headers = requestHeadersForOrigin(
        options.headers,
        options.credential,
        validated.url.origin,
      );
      const requestInit = {
        method,
        body,
        headers,
        signal: bounded.signal,
        redirect: "manual",
      } satisfies RequestInit;
      let response: Response;
      try {
        response = options.transport
          ? await options.transport(
              validated.url,
              requestInit,
              validated.addresses,
              connectTimeoutMs,
            )
          : await pinnedModelTransport(
              validated.url,
              requestInit,
              validated.addresses,
              connectTimeoutMs,
              options.policy.placement,
            );
      } catch (error) {
        if (bounded.signal.aborted) throw bounded.signal.reason;
        if (error instanceof ModelEndpointPolicyError) throw error;
        throw new ModelEndpointPolicyError(
          "transport_failed",
          "Model endpoint transport failed",
          { cause: error },
        );
      }

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        void response.body?.cancel();
        if (redirects >= maxRedirects) {
          throw new ModelEndpointPolicyError(
            "redirect_rejected",
            "Model endpoint returned too many redirects",
          );
        }
        const next = new URL(location, validated.url);
        if (next.origin !== initialOrigin) {
          throw new ModelEndpointPolicyError(
            "redirect_rejected",
            "Model endpoint cannot redirect to another origin",
          );
        }
        const nextMethod = redirectMethod(response.status, method);
        if (nextMethod === "GET" && method !== "GET") body = undefined;
        method = nextMethod;
        current = next;
        continue;
      }
      return boundedModelResponse(response, bounded, maxBytes, readTimeoutMs);
    }
  } catch (error) {
    bounded.dispose();
    throw error;
  }
}

export async function safeModelRequestText(
  input: string | URL,
  options: SafeModelRequestOptions,
): Promise<{ status: number; headers: Headers; text: string; finalUrl: URL }> {
  const bounded = totalSignal(options.signal, options.totalTimeoutMs ?? 30_000);
  const maxRedirects = options.maxRedirects ?? 2;
  const maxBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  const readTimeoutMs = options.readTimeoutMs ?? 10_000;
  let current = input instanceof URL ? new URL(input) : new URL(input);
  const initialOrigin = current.origin;
  let method = (options.method ?? "POST").toUpperCase();
  let body = options.body;

  try {
    for (let redirects = 0; ; redirects += 1) {
      if (bounded.signal.aborted) throw bounded.signal.reason;
      const validated = await validateModelEndpoint(current, options.policy);
      const headers = requestHeadersForOrigin(
        options.headers,
        options.credential,
        validated.url.origin,
      );

      let response: Response;
      try {
        const requestInit = {
          method,
          body,
          headers,
          signal: bounded.signal,
          redirect: "manual",
        } satisfies RequestInit;
        response = options.transport
          ? await options.transport(
              validated.url,
              requestInit,
              validated.addresses,
              connectTimeoutMs,
            )
          : await pinnedModelTransport(
              validated.url,
              requestInit,
              validated.addresses,
              connectTimeoutMs,
              options.policy.placement,
            );
      } catch (error) {
        if (bounded.signal.aborted) throw bounded.signal.reason;
        if (error instanceof ModelEndpointPolicyError) throw error;
        throw new ModelEndpointPolicyError(
          "transport_failed",
          "Model endpoint transport failed",
          { cause: error },
        );
      }

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        void response.body?.cancel();
        if (redirects >= maxRedirects) {
          throw new ModelEndpointPolicyError(
            "redirect_rejected",
            "Model endpoint returned too many redirects",
          );
        }
        const next = new URL(location, validated.url);
        if (next.origin !== initialOrigin) {
          throw new ModelEndpointPolicyError(
            "redirect_rejected",
            "Model endpoint cannot redirect to another origin",
          );
        }
        const nextMethod = redirectMethod(response.status, method);
        if (nextMethod === "GET" && method !== "GET") body = undefined;
        method = nextMethod;
        current = next;
        continue;
      }

      return {
        status: response.status,
        headers: response.headers,
        text: await readBoundedText(
          response,
          maxBytes,
          readTimeoutMs,
          bounded.signal,
        ),
        finalUrl: validated.url,
      };
    }
  } finally {
    bounded.dispose();
  }
}
