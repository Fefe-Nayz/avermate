import {
  nodeCapabilityEventV1Schema,
  nodeCapabilityJobManifestV1Schema,
  nodeCapabilityOfferingSchema,
  nodeCapabilityRequestV1Schema,
  nodeCapabilityResultV1Schema,
  type NodeCapabilityEventV1,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityOffering,
  type NodeCapabilityRequestV1,
  type NodeCapabilityResultV1,
} from "@avermate/agent-contracts";
import type {
  NodeCapabilityAdapter,
  NodeCapabilityAdapterContext,
  NodeCapabilityInvocationMode,
} from "./registry";
import {
  assertNodeLocalSidecarResolution,
  parseNodeLocalSidecarBaseUrl,
} from "./local-endpoint";
import { NodeSidecarArtifactIo, sidecarWireLimit } from "./sidecar-artifacts";

const DEFAULT_MAXIMUM_BYTES = 16 * 1024 * 1024;
const ABSOLUTE_MAXIMUM_BYTES = 64 * 1024 * 1024;
const MAXIMUM_STREAM_LINE_BYTES = 1024 * 1024;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

function normalizedBase(value: string) {
  return parseNodeLocalSidecarBaseUrl(value);
}

function target(base: URL, offeringId: string, action: string) {
  const url = new URL(base);
  url.pathname = `${base.pathname}v1/capabilities/${encodeURIComponent(offeringId)}/${action}`;
  return url;
}

function responseLimit(offering: NodeCapabilityOffering) {
  return Math.min(
    offering.descriptor.limits.maxOutputBytes ?? DEFAULT_MAXIMUM_BYTES,
    ABSOLUTE_MAXIMUM_BYTES,
  );
}

function combinedSignal(context: NodeCapabilityAdapterContext) {
  const deadlineMs = Date.parse(context.deadline) - Date.now();
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error("NODE_CAPABILITY_DEADLINE_EXPIRED");
  }
  return AbortSignal.any([
    context.signal,
    AbortSignal.timeout(Math.min(deadlineMs, 24 * 60 * 60_000)),
  ]);
}

async function boundedResolution<T>(
  operation: Promise<T>,
  deadline: string,
) {
  const maximumMs = Math.min(
    10_000,
    Math.max(1, Date.parse(deadline) - Date.now()),
  );
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("NODE_CAPABILITY_SIDECAR_DNS_UNAVAILABLE")),
      maximumMs,
    );
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function boundedBytes(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error("NODE_CAPABILITY_SIDECAR_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response limit exceeded");
        throw new Error("NODE_CAPABILITY_SIDECAR_RESPONSE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function responseError(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return "NODE_CAPABILITY_SIDECAR_UNAUTHORIZED";
  }
  if (response.status === 408 || response.status === 429) {
    return "NODE_CAPABILITY_SIDECAR_RATE_LIMITED";
  }
  return response.status >= 500
    ? "NODE_CAPABILITY_SIDECAR_UNAVAILABLE"
    : "NODE_CAPABILITY_SIDECAR_REJECTED";
}

/**
 * Client for an operator-configured Node-private capability sidecar. The base
 * URL and secret reference are constructor-private and never enter manifests.
 */
export class NodeCapabilityHttpSidecarAdapter
  implements NodeCapabilityAdapter
{
  readonly offering: NodeCapabilityOffering;
  readonly invocationModes: readonly NodeCapabilityInvocationMode[];
  readonly #base: URL;
  readonly #credentialSlot: string | null;
  readonly #healthTimeoutMs: number;
  readonly #healthCredential?: (
    slot: string,
  ) => Promise<{ value: string; version: number } | null>;
  readonly #fetch: Fetcher;
  readonly #resolve?: (hostname: string) => Promise<readonly string[]>;
  readonly #artifacts?: NodeSidecarArtifactIo;

  constructor(input: {
    offering: NodeCapabilityOffering;
    invocationModes: readonly NodeCapabilityInvocationMode[];
    baseUrl: string;
    credentialSlot?: string;
    healthTimeoutMs?: number;
    healthCredential?: (
      slot: string,
    ) => Promise<{ value: string; version: number } | null>;
    fetch?: Fetcher;
    resolveHostname?: (hostname: string) => Promise<readonly string[]>;
    artifacts?: NodeSidecarArtifactIo;
  }) {
    this.offering = nodeCapabilityOfferingSchema.parse(input.offering);
    this.invocationModes = [...input.invocationModes];
    this.#base = normalizedBase(input.baseUrl);
    this.#credentialSlot = input.credentialSlot ?? null;
    this.#healthTimeoutMs = Math.min(
      Math.max(Math.trunc(input.healthTimeoutMs ?? 10_000), 100),
      60_000,
    );
    this.#healthCredential = input.healthCredential;
    this.#fetch = input.fetch ?? globalThis.fetch;
    this.#resolve = input.resolveHostname;
    this.#artifacts = input.artifacts;
  }

  async invoke(
    context: NodeCapabilityAdapterContext,
    raw: NodeCapabilityRequestV1,
  ) {
    const request = nodeCapabilityRequestV1Schema.parse(raw);
    return this.#result(context, request, await this.#json(context, "invoke", await this.#body(context, request)));
  }

  async *stream(
    context: NodeCapabilityAdapterContext,
    raw: NodeCapabilityRequestV1,
  ): AsyncIterable<NodeCapabilityEventV1> {
    const request = nodeCapabilityRequestV1Schema.parse(raw);
    const response = await this.#request(context, "stream", await this.#body(context, request), {
      accept: "application/x-ndjson",
    });
    if (!response.ok) throw new Error(responseError(response));
    if (
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/x-ndjson")
    ) {
      throw new Error("NODE_CAPABILITY_SIDECAR_CONTENT_TYPE_INVALID");
    }
    if (!response.body) {
      throw new Error("NODE_CAPABILITY_SIDECAR_STREAM_MISSING");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const maximumBytes = responseLimit(this.offering);
    let total = 0;
    let buffer = "";
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maximumBytes) {
          await reader.cancel("response limit exceeded");
          throw new Error("NODE_CAPABILITY_SIDECAR_RESPONSE_TOO_LARGE");
        }
        buffer += decoder.decode(next.value, { stream: true });
        while (true) {
          const boundary = buffer.indexOf("\n");
          if (boundary < 0) break;
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          if (!line) continue;
          if (new TextEncoder().encode(line).byteLength > MAXIMUM_STREAM_LINE_BYTES) {
            throw new Error("NODE_CAPABILITY_SIDECAR_EVENT_TOO_LARGE");
          }
          yield nodeCapabilityEventV1Schema.parse(JSON.parse(line));
        }
        if (new TextEncoder().encode(buffer).byteLength > MAXIMUM_STREAM_LINE_BYTES) {
          throw new Error("NODE_CAPABILITY_SIDECAR_EVENT_TOO_LARGE");
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        yield nodeCapabilityEventV1Schema.parse(JSON.parse(buffer));
      }
    } finally {
      reader.releaseLock();
    }
  }

  async artifactJob(
    context: NodeCapabilityAdapterContext,
    raw: NodeCapabilityJobManifestV1,
  ): Promise<NodeCapabilityResultV1> {
    const manifest = nodeCapabilityJobManifestV1Schema.parse(raw);
    return this.#result(context, manifest, await this.#json(context, "artifact-job", await this.#body(context, manifest)));
  }

  async #body(context: NodeCapabilityAdapterContext, request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1) {
    if (this.#artifacts) return this.#artifacts.request(context, request, this.offering.descriptor.limits.maxInputBytes ?? DEFAULT_MAXIMUM_BYTES);
    if (("inputArtifacts" in request ? request.inputArtifacts : request.inputs).length > 0) {
      throw new Error("NODE_CAPABILITY_SIDECAR_ARTIFACT_IO_REQUIRED");
    }
    return request;
  }

  async #result(context: NodeCapabilityAdapterContext, request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1, raw: unknown) {
    if (this.#artifacts) return this.#artifacts.result(context, request, raw, responseLimit(this.offering));
    const result = nodeCapabilityResultV1Schema.parse(raw);
    if (result.outputArtifacts.length > 0) throw new Error("NODE_CAPABILITY_SIDECAR_ARTIFACT_IO_REQUIRED");
    return result;
  }

  async health() {
    const response = await this.#request(
      {
        ownerId: "health",
        operationId: `health_${crypto.randomUUID()}`,
        deadline: new Date(Date.now() + this.#healthTimeoutMs).toISOString(),
        signal: new AbortController().signal,
        credential: (slot) => this.#healthCredential?.(slot) ?? Promise.resolve(null),
      },
      "health",
      null,
      { accept: "application/json", method: "GET" },
    );
    if (!response.ok) throw new Error(responseError(response));
    await boundedBytes(response, 4 * 1024);
  }

  async #json(
    context: NodeCapabilityAdapterContext,
    action: string,
    body: unknown,
  ) {
    const response = await this.#request(context, action, body, {
      accept: "application/json",
    });
    if (!response.ok) throw new Error(responseError(response));
    if (
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      throw new Error("NODE_CAPABILITY_SIDECAR_CONTENT_TYPE_INVALID");
    }
    const bytes = await boundedBytes(response, sidecarWireLimit(responseLimit(this.offering)));
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("NODE_CAPABILITY_SIDECAR_RESPONSE_MALFORMED");
    }
  }

  async #request(
    context: NodeCapabilityAdapterContext,
    action: string,
    body: unknown,
    options: { accept: string; method?: "GET" },
  ) {
    const resolvedAddresses = await boundedResolution(
      assertNodeLocalSidecarResolution(this.#base, this.#resolve),
      context.deadline,
    );
    const headers = new Headers({ accept: options.accept });
    headers.set("x-avermate-artifact-protocol", "inline-base64-v1");
    let serialized: string | undefined;
    if (options.method !== "GET") {
      serialized = JSON.stringify(body);
      const maximumInput = sidecarWireLimit(Math.min(
        this.offering.descriptor.limits.maxInputBytes ?? DEFAULT_MAXIMUM_BYTES,
        ABSOLUTE_MAXIMUM_BYTES,
      ));
      if (new TextEncoder().encode(serialized).byteLength > maximumInput) {
        throw new Error("NODE_CAPABILITY_SIDECAR_REQUEST_TOO_LARGE");
      }
      headers.set("content-type", "application/json");
    }
    if (this.#credentialSlot) {
      const credential = await context.credential(this.#credentialSlot);
      if (!credential) throw new Error("NODE_CAPABILITY_CREDENTIAL_REQUIRED");
      headers.set("authorization", `Bearer ${credential.value}`);
    }
    const requestTarget = target(
      this.#base,
      this.offering.descriptor.id,
      action,
    );
    if (this.#base.hostname.toLowerCase().replace(/^\[|\]$/gu, "") !== resolvedAddresses[0]) {
      headers.set("host", this.#base.host);
      requestTarget.hostname = resolvedAddresses[0]!.includes(":")
        ? `[${resolvedAddresses[0]}]`
        : resolvedAddresses[0]!;
    }
    const response = await this.#fetch(
      requestTarget,
      {
        method: options.method ?? "POST",
        headers,
        ...(serialized === undefined ? {} : { body: serialized }),
        redirect: "manual",
        signal: combinedSignal(context),
      },
    );
    if (response.status >= 300 && response.status < 400) {
      throw new Error("NODE_CAPABILITY_SIDECAR_REDIRECT_DENIED");
    }
    return response;
  }
}
