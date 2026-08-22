import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { NonRetryableSyncError, RetryableSyncError } from "./errors";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

export interface ProviderLookupAddress {
  address: string;
  family: number;
}

export type ProviderLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ProviderLookupAddress[]>;

export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderTransport = (
  url: URL,
  init: RequestInit,
  addresses: readonly ProviderLookupAddress[],
) => Promise<Response>;

export interface SafeProviderRequestOptions {
  expectedOrigin?: string;
  fetch?: ProviderFetch;
  lookup?: ProviderLookup;
  maxRedirects?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  transport?: ProviderTransport;
}

export interface SafeProviderTextResponse {
  status: number;
  headers: Headers;
  content: string;
  finalUrl: URL;
}

const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::", 96],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fec0::", 10],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(
        typeof signal.reason === "string"
          ? signal.reason
          : "The provider request was aborted",
      );
}

export function throwIfProviderAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal);
}

export function isPublicProviderAddress(address: string) {
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mappedIpv4?.[1]) return isPublicProviderAddress(mappedIpv4[1]);
  const hexadecimalMappedIpv4 = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i.exec(
    address,
  );
  if (hexadecimalMappedIpv4) {
    const high = Number.parseInt(hexadecimalMappedIpv4[1]!, 16);
    const low = Number.parseInt(hexadecimalMappedIpv4[2]!, 16);
    return isPublicProviderAddress(
      `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`,
    );
  }
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family === 6) return !blockedAddresses.check(address, "ipv6");
  return false;
}

function hostnameIsLocal(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa")
  );
}

export async function assertPublicProviderUrl(
  url: URL,
  options: Pick<SafeProviderRequestOptions, "expectedOrigin" | "lookup"> = {},
) {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname ||
    hostnameIsLocal(url.hostname)
  ) {
    throw new NonRetryableSyncError(
      "The provider URL must be a public HTTPS address",
    );
  }
  if (options.expectedOrigin && url.origin !== options.expectedOrigin) {
    throw new NonRetryableSyncError(
      "The provider redirected outside its approved origin",
    );
  }

  const literalFamily = isIP(url.hostname);
  if (literalFamily) {
    if (!isPublicProviderAddress(url.hostname)) {
      throw new NonRetryableSyncError(
        "The provider URL cannot target a private network",
      );
    }
    return [{ address: url.hostname, family: literalFamily }];
  }

  let addresses: ProviderLookupAddress[];
  try {
    const lookup = options.lookup ?? (dnsLookup as ProviderLookup);
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new RetryableSyncError(
      "The provider hostname could not be resolved securely",
      { cause: error },
    );
  }
  if (addresses.length === 0) {
    throw new RetryableSyncError(
      "The provider hostname did not resolve to an address",
    );
  }
  if (addresses.some(({ address }) => !isPublicProviderAddress(address))) {
    throw new NonRetryableSyncError(
      "The provider hostname resolves to a private network",
    );
  }
  return addresses.map(({ address, family }) => ({ address, family }));
}

/**
 * Builds the DNS callback used by the HTTPS socket from an immutable snapshot
 * of addresses that already passed the public-network policy. No resolver is
 * consulted between policy validation and connect, closing DNS-rebinding TOCTOU.
 */
export function createPinnedProviderLookup(
  addresses: readonly ProviderLookupAddress[],
): LookupFunction {
  const pinned = addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
  if (
    pinned.length === 0 ||
    pinned.some(({ address }) => !isPublicProviderAddress(address))
  ) {
    throw new NonRetryableSyncError(
      "The provider transport received an unsafe DNS result",
    );
  }
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, pinned);
      return;
    }
    const first = pinned[0]!;
    callback(null, first.address, first.family);
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
  throw new NonRetryableSyncError(
    "The provider request body type is not supported by the pinned transport",
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

async function pinnedHttpsTransport(
  url: URL,
  init: RequestInit,
  addresses: readonly ProviderLookupAddress[],
) {
  const body = await requestBody(init.body);
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  return new Promise<Response>((resolve, reject) => {
    const ca = (init as RequestInit & { tls?: { ca?: string } }).tls?.ca;
    const request = httpsRequest(
      url,
      {
        headers,
        lookup: createPinnedProviderLookup(addresses),
        method: init.method,
        signal: init.signal ?? undefined,
        ...(ca ? { ca } : {}),
      },
      (incoming) => {
        const status = incoming.statusCode ?? 502;
        const stream = Readable.toWeb(
          incoming,
        ) as unknown as ReadableStream<Uint8Array>;
        try {
          resolve(
            new Response(stream, {
              headers: responseHeaders(incoming),
              status,
            }),
          );
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      },
    );
    request.once("error", reject);
    if (body !== undefined) request.end(body);
    else request.end();
  });
}

/**
 * Returns a streaming response over the same DNS snapshot that passed policy.
 * Callers own and must consume/cancel the response body. Redirects are never
 * followed by this transport, so the caller can fail closed on any 3xx.
 */
export async function fetchPinnedProviderResponse(
  input: string | URL,
  init: RequestInit = {},
  options: Pick<
    SafeProviderRequestOptions,
    "expectedOrigin" | "fetch" | "lookup" | "signal" | "timeoutMs" | "transport"
  > = {},
) {
  throwIfProviderAborted(options.signal);
  const url = input instanceof URL ? new URL(input) : new URL(input);
  const bounded = boundedSignal(
    options.signal,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  let addresses: ProviderLookupAddress[];
  try {
    addresses = await awaitProviderSignal(
      assertPublicProviderUrl(url, options),
      bounded.signal,
    );
  } catch (error) {
    bounded.cleanup();
    throw error;
  }
  const requestInit = {
    ...init,
    redirect: "manual",
    signal: bounded.signal,
  } satisfies RequestInit;
  let response: Response;
  try {
    const pendingResponse = (
      options.fetch
        ? options.fetch(url, requestInit)
        : (options.transport ?? pinnedHttpsTransport)(
            url,
            requestInit,
            addresses,
          )
    ).then((result) => {
      if (!bounded.signal.aborted) return result;
      void result.body?.cancel().catch(() => undefined);
      throw abortError(bounded.signal);
    });
    // If the deadline wins the race, still observe and dispose a response that
    // an injected/non-cooperative transport resolves afterwards.
    void pendingResponse.catch(() => undefined);
    response = await awaitProviderSignal(pendingResponse, bounded.signal);
  } catch (error) {
    try {
      throwIfProviderAborted(bounded.signal);
    } finally {
      bounded.cleanup();
    }
    throw error;
  }
  return boundedStreamingResponse(response, bounded);
}

function boundedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortError(parent!));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new RetryableSyncError("The provider request timed out"),
      ),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

function awaitProviderSignal<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function boundedStreamingResponse(
  response: Response,
  bounded: ReturnType<typeof boundedSignal>,
) {
  if (!response.body) {
    bounded.cleanup();
    return response;
  }
  const reader = response.body.getReader();
  let finished = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const finish = () => {
    if (finished) return false;
    finished = true;
    bounded.signal.removeEventListener("abort", onAbort);
    bounded.cleanup();
    reader.releaseLock();
    return true;
  };
  const onAbort = () => {
    if (finished) return;
    const error = abortError(bounded.signal);
    void reader.cancel(error).catch(() => undefined);
    if (finish()) streamController?.error(error);
  };
  bounded.signal.addEventListener("abort", onAbort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    async pull(controller) {
      if (finished) return;
      try {
        throwIfProviderAborted(bounded.signal);
        const chunk = await reader.read();
        if (finished) return;
        if (chunk.done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
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
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new NonRetryableSyncError(
      "The provider response exceeds the allowed size",
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let byteSize = 0;
  const onAbort = () => {
    void reader.cancel(abortError(signal)).catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      throwIfProviderAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      byteSize += value.byteLength;
      if (byteSize > maxBytes) {
        throw new NonRetryableSyncError(
          "The provider response exceeds the allowed size",
        );
      }
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    return content;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throwIfProviderAborted(signal);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function redirectedMethod(status: number, method: string | undefined) {
  if (
    status === 303 ||
    ((status === 301 || status === 302) && method === "POST")
  ) {
    return "GET";
  }
  return method;
}

/**
 * Fetch a bounded text response while validating DNS before every request and
 * every redirect. Provider SDKs use this instead of an unconstrained global
 * fetch so user-supplied school URLs cannot become an SSRF primitive.
 */
export async function fetchSafeProviderText(
  input: string | URL,
  init: RequestInit = {},
  options: SafeProviderRequestOptions = {},
): Promise<SafeProviderTextResponse> {
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let url = input instanceof URL ? new URL(input) : new URL(input);
  let method = init.method?.toUpperCase();
  let body = init.body;

  for (let redirect = 0; ; redirect += 1) {
    throwIfProviderAborted(options.signal);
    const bounded = boundedSignal(options.signal, timeoutMs);
    let addresses: ProviderLookupAddress[];
    try {
      addresses = await awaitProviderSignal(
        assertPublicProviderUrl(url, options),
        bounded.signal,
      );
    } catch (error) {
      bounded.cleanup();
      throw error;
    }
    let response: Response;
    try {
      const requestInit = {
        ...init,
        body,
        method,
        redirect: "manual",
        signal: bounded.signal,
      } satisfies RequestInit;
      const pendingResponse = (
        options.fetch
          ? options.fetch(url, requestInit)
          : (options.transport ?? pinnedHttpsTransport)(
              url,
              requestInit,
              addresses,
            )
      ).then((result) => {
        if (!bounded.signal.aborted) return result;
        void result.body?.cancel().catch(() => undefined);
        throw abortError(bounded.signal);
      });
      void pendingResponse.catch(() => undefined);
      response = await awaitProviderSignal(pendingResponse, bounded.signal);
    } catch (error) {
      try {
        throwIfProviderAborted(bounded.signal);
      } finally {
        bounded.cleanup();
      }
      throw new RetryableSyncError(
        "The provider could not be reached securely",
        {
          cause: error,
        },
      );
    }

    const location = response.headers.get("location");
    const isRedirect =
      response.status >= 300 && response.status < 400 && location;
    if (isRedirect && init.redirect !== "manual") {
      void response.body?.cancel().catch(() => undefined);
      bounded.cleanup();
      if (redirect >= maxRedirects) {
        throw new NonRetryableSyncError(
          "The provider returned too many redirects",
        );
      }
      url = new URL(location, url);
      const nextMethod = redirectedMethod(response.status, method);
      if (nextMethod === "GET" && method !== "GET") body = undefined;
      method = nextMethod;
      continue;
    }

    try {
      const content = await readBoundedText(response, maxBytes, bounded.signal);
      return {
        status: response.status,
        headers: response.headers,
        content,
        finalUrl: url,
      };
    } finally {
      bounded.cleanup();
    }
  }
}
