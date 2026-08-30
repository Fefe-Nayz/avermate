import {
  canonicalCapabilityJson,
  capabilityArtifactRefSchema,
  capabilityOfferingSchema,
  capabilityRequestSchemas,
  capabilityResultSchemas,
  localOcrWorkerOutputV1Schema,
  localTranscriptionWorkerOutputV1Schema,
  nodeArtifactWorkerRequestV1Schema,
  nodeCapabilityJobManifestV1Schema,
  nodeCapabilityEventV1Schema,
  nodeCapabilityOfferingSchema,
  nodeCapabilityRequestDigestPayload,
  nodeCapabilityRequestV1Schema,
  nodeCapabilityResultDigestPayload,
  nodeCapabilityResultV1Schema,
  signedNodeCapabilityInvocationGrantSchema,
  type CapabilityAdapter,
  type CapabilityArtifactRef,
  type CapabilityAttemptContext,
  type CapabilityKind,
  type CapabilityOffering,
  type CapabilityOfferingSnapshot,
  type CapabilityRequestMap,
  type CapabilityResultMap,
  type NodeCapabilityEventV1,
  type ModelGatewayEvent,
  type NodeCapabilityExecutionLimits,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityOffering,
  type NodeCapabilityRequestV1,
  type NodeCapabilityResultV1,
  type NodeCapabilityTransport,
  type ProviderConnectionPublicSnapshot,
  type ProviderPlugin,
  type ProviderPluginManifest,
  type SignedNodeCapabilityInvocationGrant,
  type UnsignedNodeCapabilityInvocationGrantClaims,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { capabilityOfferingIdentity } from "../offering-store";
import { capabilityDigest } from "../values";
import { CapabilityExecutionError, capabilityFailure } from "../errors";
import { nodeLanguageEvent } from "./node-language-stream";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_NODE_OUTPUT_BYTES = 256 * 1024 * 1024;
const MAX_NODE_TRANSFER_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_NODE_GRANT_MS = 5 * 60_000;
const MAX_NODE_ARTIFACT_BYTES = 512 * 1024 * 1024;
const NODE_INPUT_NAMESPACE = "capability-inputs";
const NODE_WORKER_OUTPUT_NAMESPACE = "artifact-worker-results";

export type CoreNodeArtifactBridge = {
  readCore(input: {
    ownerId: string;
    artifact: CapabilityArtifactRef;
    maximumBytes: number;
    signal: AbortSignal;
  }): Promise<Uint8Array>;
  putNode(input: {
    nodeId: string;
    ownerId: string;
    artifact: CapabilityArtifactRef;
    bytes: Uint8Array;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<{ artifact: CapabilityArtifactRef; replayed: boolean }>;
  readNode(input: {
    nodeId: string;
    ownerId: string;
    artifact: CapabilityArtifactRef;
    maximumBytes: number;
    signal: AbortSignal;
  }): Promise<Uint8Array>;
  adoptCore(input: {
    nodeId: string;
    ownerId: string;
    operationId: string;
    artifact: CapabilityArtifactRef;
    bytes: Uint8Array;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<CapabilityArtifactRef>;
  deleteNode(input: {
    nodeId: string;
    ownerId: string;
    artifact: CapabilityArtifactRef;
    idempotencyKey: string;
  }): Promise<void>;
};

export type CoreNodePluginDependencies = {
  transport: NodeCapabilityTransport;
  signGrant(
    claims: UnsignedNodeCapabilityInvocationGrantClaims,
  ): SignedNodeCapabilityInvocationGrant;
  now(): Date;
  artifacts?: CoreNodeArtifactBridge;
};

type DependencyResolver = () => Promise<CoreNodePluginDependencies>;

function nodeConfig(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("NODE_CAPABILITY_CONFIG_INVALID");
  }
  const keys = Object.keys(config);
  const value = config as Record<string, unknown>;
  if (
    keys.length !== 2 ||
    typeof value.nodeId !== "string" ||
    value.nodeId.trim().length === 0 ||
    value.nodeId.length > 256 ||
    typeof value.configRevision !== "string" ||
    !DIGEST_PATTERN.test(value.configRevision)
  ) {
    throw new Error("NODE_CAPABILITY_CONFIG_INVALID");
  }
  return {
    nodeId: value.nodeId,
    configRevision: value.configRevision as `sha256:${string}`,
  };
}

function assertConnection(
  connection: ProviderConnectionPublicSnapshot,
  manifest: ProviderPluginManifest,
) {
  const config = nodeConfig(connection.config);
  if (
    connection.pluginId !== manifest.id ||
    connection.pluginVersion !== manifest.version ||
    connection.placement.kind !== "node" ||
    connection.placement.nodeId !== config.nodeId ||
    connection.placement.configRevision !== config.configRevision
  ) {
    throw new Error("NODE_CAPABILITY_CONNECTION_BINDING_INVALID");
  }
  return config;
}

function checkedNodeOffering(
  raw: NodeCapabilityOffering,
  config: ReturnType<typeof nodeConfig>,
) {
  const offering = nodeCapabilityOfferingSchema.parse(raw);
  if (
    capabilityDigest(offering.descriptor) !== offering.descriptorDigest ||
    offering.descriptor.placement.kind !== "node" ||
    offering.descriptor.placement.nodeId !== config.nodeId ||
    offering.descriptor.placement.configRevision !== config.configRevision
  ) {
    throw new Error("NODE_CAPABILITY_OFFERING_BINDING_INVALID");
  }
  return offering;
}

export function bridgeNodeCapabilityOffering(input: {
  advertised: NodeCapabilityOffering;
  connection: ProviderConnectionPublicSnapshot;
  manifest: ProviderPluginManifest;
}) {
  const config = assertConnection(input.connection, input.manifest);
  const advertised = checkedNodeOffering(input.advertised, config);
  if (!input.manifest.capabilities.includes(advertised.descriptor.capability)) {
    throw new Error("NODE_CAPABILITY_KIND_NOT_REVIEWED");
  }
  const { id: _advertisedId, ...semantic } = advertised.descriptor;
  const identity: Omit<CapabilityOffering, "id"> = {
    ...semantic,
    connectionId: input.connection.id,
    connectionRevision: input.connection.revision,
    pluginId: input.manifest.id,
    pluginVersion: input.manifest.version,
    adapterRevision: `node-capability-v1:${advertised.descriptorDigest.slice(7, 23)}`,
    placement: {
      kind: "node",
      nodeId: config.nodeId,
      configRevision: config.configRevision,
    },
    healthCheckKind: "node-attested",
  } as Omit<CapabilityOffering, "id">;
  return capabilityOfferingSchema.parse({
    ...identity,
    id: capabilityOfferingIdentity(identity),
  });
}

function collectArtifacts(value: unknown, ownerId: string) {
  const collected = new Map<string, CapabilityArtifactRef>();
  const seen = new Set<object>();
  const visit = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    const parsed = capabilityArtifactRefSchema.safeParse(current);
    if (parsed.success) {
      if (parsed.data.object.ownerId !== ownerId) {
        throw new Error("NODE_CAPABILITY_ARTIFACT_OWNER_MISMATCH");
      }
      collected.set(canonicalCapabilityJson(parsed.data), parsed.data);
      return;
    }
    if (seen.has(current)) throw new Error("NODE_CAPABILITY_INPUT_CYCLE");
    seen.add(current);
    try {
      for (const child of Array.isArray(current)
        ? current
        : Object.values(current as Record<string, unknown>)) {
        visit(child);
      }
    } finally {
      seen.delete(current);
    }
  };
  visit(value);
  const artifacts = [...collected.values()].sort((left, right) =>
    canonicalCapabilityJson(left).localeCompare(canonicalCapabilityJson(right)),
  );
  if (artifacts.length > 256) {
    throw new Error("NODE_CAPABILITY_ARTIFACT_LIMIT_EXCEEDED");
  }
  return artifacts;
}

function artifactDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertOutputMime(artifact: CapabilityArtifactRef, bytes: Uint8Array) {
  const prefix = (text: string, offset = 0) =>
    [...text].every(
      (character, index) => bytes[offset + index] === character.charCodeAt(0),
    );
  const mime = artifact.mimeType.toLowerCase();
  let valid = false;
  if (mime === "image/png")
    valid = bytes[0] === 0x89 && prefix("PNG\r\n\u001a\n", 1);
  else if (mime === "image/jpeg")
    valid = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  else if (mime === "image/webp") valid = prefix("RIFF") && prefix("WEBP", 8);
  else if (mime === "application/pdf") valid = prefix("%PDF-");
  else if (mime === "audio/wav") valid = prefix("RIFF") && prefix("WAVE", 8);
  else if (mime === "audio/ogg") valid = prefix("OggS");
  else if (mime === "audio/flac") valid = prefix("fLaC");
  else if (mime === "audio/mpeg" || mime === "audio/aac")
    valid =
      prefix("ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
  else if (mime === "audio/mp4" || mime === "audio/m4a" || mime === "video/mp4")
    valid = prefix("ftyp", 4);
  else if (mime === "audio/webm" || mime === "video/webm")
    valid =
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3;
  else if (
    mime ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
    valid = prefix("PK\u0003\u0004");
  else if (
    [
      "application/json",
      "text/plain",
      "text/html",
      "text/tab-separated-values",
    ].includes(mime)
  ) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (mime === "application/json") JSON.parse(text);
      valid = !text.includes("\u0000");
    } catch {
      valid = false;
    }
  } else {
    throw new Error("NODE_CAPABILITY_OUTPUT_ARTIFACT_MIME_UNSUPPORTED");
  }
  if (!valid) throw new Error("NODE_CAPABILITY_OUTPUT_ARTIFACT_MIME_MISMATCH");
}

function stableHash(value: unknown) {
  return createHash("sha256")
    .update(canonicalCapabilityJson(value))
    .digest("hex");
}

function artifactAuthority(artifact: CapabilityArtifactRef) {
  return canonicalCapabilityJson(artifact);
}

function rewriteArtifactRefs(
  value: unknown,
  replacements: ReadonlyMap<string, CapabilityArtifactRef>,
): unknown {
  if (!value || typeof value !== "object") return value;
  const artifact = capabilityArtifactRefSchema.safeParse(value);
  if (artifact.success) {
    return replacements.get(artifactAuthority(artifact.data)) ?? artifact.data;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteArtifactRefs(entry, replacements));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      rewriteArtifactRefs(entry, replacements),
    ]),
  );
}

type StagedArtifact = {
  source: CapabilityArtifactRef | null;
  node: CapabilityArtifactRef;
};

type StagedInvocation<K extends CapabilityKind> = {
  input: CapabilityRequestMap[K];
  artifacts: CapabilityArtifactRef[];
  staged: StagedArtifact[];
};

function nodeStagingArtifact(input: {
  ownerId: string;
  nodeId: string;
  operationId: string;
  role: string;
  source: CapabilityArtifactRef | null;
  bytes: Uint8Array;
  mimeType: string;
}) {
  const digest = artifactDigest(input.bytes);
  const authority = stableHash({
    version: 1,
    nodeId: input.nodeId,
    operationId: input.operationId,
    role: input.role,
    source: input.source,
    digest,
  });
  return capabilityArtifactRefSchema.parse({
    object: {
      ownerId: input.ownerId,
      namespace: NODE_INPUT_NAMESPACE,
      key: `v1/${authority.slice(0, 32)}/${authority.slice(32)}`,
    },
    digest,
    byteSize: input.bytes.byteLength,
    mimeType: input.mimeType,
  });
}

function stagingIdempotencyKey(artifact: CapabilityArtifactRef) {
  return `capability-stage-${stableHash(artifact).slice(0, 48)}`;
}

function cleanupIdempotencyKey(
  phase: "input" | "output",
  artifact: CapabilityArtifactRef,
) {
  return `capability-${phase}-cleanup-${stableHash(artifact).slice(0, 48)}`;
}

function exactArtifacts(
  left: readonly CapabilityArtifactRef[],
  right: readonly CapabilityArtifactRef[],
) {
  const normalized = (values: readonly CapabilityArtifactRef[]) =>
    values.map(canonicalCapabilityJson).sort();
  return (
    canonicalCapabilityJson(normalized(left)) ===
    canonicalCapabilityJson(normalized(right))
  );
}

function grantDeadline(context: CapabilityAttemptContext, now: Date) {
  const deadline = new Date(
    Math.min(context.deadline.getTime(), now.getTime() + MAX_NODE_GRANT_MS),
  );
  if (deadline.getTime() <= now.getTime()) {
    throw new Error("NODE_CAPABILITY_DEADLINE_EXPIRED");
  }
  return deadline;
}

function executionLimits(input: {
  serializedInput: unknown;
  artifacts: readonly CapabilityArtifactRef[];
  offering: CapabilityOffering;
  deadline: Date;
  now: Date;
}): NodeCapabilityExecutionLimits {
  const serialized = new TextEncoder().encode(
    JSON.stringify(input.serializedInput),
  ).byteLength;
  const artifacts = input.artifacts.reduce(
    (total, artifact) => total + artifact.byteSize,
    0,
  );
  const inputBytes = serialized + artifacts;
  if (
    !Number.isSafeInteger(inputBytes) ||
    (input.offering.limits.maxInputBytes !== null &&
      inputBytes > input.offering.limits.maxInputBytes)
  ) {
    throw new Error("NODE_CAPABILITY_INPUT_LIMIT_EXCEEDED");
  }
  return {
    cpuMillis: Math.max(1, input.deadline.getTime() - input.now.getTime()),
    memoryBytes: 2 * 1024 * 1024 * 1024,
    inputBytes,
    outputBytes: Math.min(
      input.offering.limits.maxOutputBytes ?? MAX_NODE_OUTPUT_BYTES,
      MAX_NODE_TRANSFER_OUTPUT_BYTES,
    ),
    tokenLimit: 10_000_000,
    costMinorLimit: 1_000_000_000,
    deadline: input.deadline.toISOString(),
  };
}

class CoreNodeCapabilityAdapter<K extends CapabilityKind> {
  readonly kind: K;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<K>,
    private readonly advertised: NodeCapabilityOffering,
    private readonly connection: ProviderConnectionPublicSnapshot,
    private readonly dependencies: CoreNodePluginDependencies,
  ) {
    this.kind = offering.capability;
  }

  descriptor() {
    return this.offering;
  }

  private artifactBridge() {
    if (!this.dependencies.artifacts) {
      throw new Error("NODE_CAPABILITY_ARTIFACT_BRIDGE_UNAVAILABLE");
    }
    return this.dependencies.artifacts;
  }

  private async putStagedArtifact(input: {
    context: CapabilityAttemptContext;
    staged: StagedArtifact[];
    source: CapabilityArtifactRef | null;
    role: string;
    bytes: Uint8Array;
    mimeType: string;
  }) {
    if (
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > MAX_NODE_ARTIFACT_BYTES
    ) {
      throw new Error("NODE_CAPABILITY_ARTIFACT_SIZE_INVALID");
    }
    const config = nodeConfig(this.connection.config);
    const artifact = nodeStagingArtifact({
      ownerId: input.context.ownerId,
      nodeId: config.nodeId,
      operationId: input.context.operationId,
      role: input.role,
      source: input.source,
      bytes: input.bytes,
      mimeType: input.mimeType,
    });
    // Track the deterministic destination before dispatch: even an uncertain put
    // can only be cleaned up at this exact owner/ref/digest.
    input.staged.push({ source: input.source, node: artifact });
    const committed = await this.artifactBridge().putNode({
      nodeId: config.nodeId,
      ownerId: input.context.ownerId,
      artifact,
      bytes: input.bytes,
      idempotencyKey: stagingIdempotencyKey(artifact),
      signal: input.context.signal,
    });
    if (artifactAuthority(committed.artifact) !== artifactAuthority(artifact)) {
      throw new Error("NODE_CAPABILITY_ARTIFACT_COMMIT_MISMATCH");
    }
    return artifact;
  }

  private async cleanupArtifacts(
    ownerId: string,
    nodeId: string,
    artifacts: readonly CapabilityArtifactRef[],
    phase: "input" | "output",
  ) {
    const bridge = this.dependencies.artifacts;
    if (!bridge) return;
    const unique = [
      ...new Map(
        artifacts.map((artifact) => [artifactAuthority(artifact), artifact]),
      ).values(),
    ]
      .filter((artifact) =>
        phase === "input"
          ? artifact.object.namespace === NODE_INPUT_NAMESPACE
          : [NODE_WORKER_OUTPUT_NAMESPACE, "capability-outputs"].includes(
              artifact.object.namespace,
            ),
      )
      .slice(0, 257);
    const cleanupDeadline = Date.now() + 5_000;
    for (let offset = 0; offset < unique.length; offset += 8) {
      const remainingMs = cleanupDeadline - Date.now();
      if (remainingMs <= 0) return;
      const deletions = Promise.allSettled(
        unique.slice(offset, offset + 8).map((artifact) =>
          bridge.deleteNode({
            nodeId,
            ownerId,
            artifact,
            idempotencyKey: cleanupIdempotencyKey(phase, artifact),
          }),
        ),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deletions,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, remainingMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  private async stageInput(
    context: CapabilityAttemptContext,
    raw: CapabilityRequestMap[K],
  ): Promise<StagedInvocation<K>> {
    const input = capabilityRequestSchemasFor(this.kind, raw);
    if (this.kind === "document.ocr" || this.kind === "speech.transcribe") {
      const media = input as
        | CapabilityRequestMap["document.ocr"]
        | CapabilityRequestMap["speech.transcribe"];
      if (media.mimeType !== media.source.mimeType)
        throw new Error("NODE_CAPABILITY_INPUT_MIME_MISMATCH");
    }
    const sources = collectArtifacts(input, context.ownerId);
    if (sources.length === 0) return { input, artifacts: [], staged: [] };
    const declaredBytes =
      new TextEncoder().encode(canonicalCapabilityJson(input)).byteLength +
      sources.reduce((sum, source) => sum + source.byteSize, 0);
    const transferLimit = this.advertised.runtime.implementation.startsWith(
      "node-sidecar:",
    )
      ? MAX_NODE_TRANSFER_OUTPUT_BYTES
      : MAX_NODE_ARTIFACT_BYTES;
    if (
      declaredBytes >
      Math.min(
        this.offering.limits.maxInputBytes ?? transferLimit,
        transferLimit,
      )
    ) {
      throw new Error("NODE_CAPABILITY_INPUT_LIMIT_EXCEEDED");
    }
    // Staging is already owner-node egress, so consent must precede byte transfer.
    await context.authorize();
    const bridge = this.artifactBridge();
    const maximumBytes = Math.min(
      this.offering.limits.maxInputBytes ?? MAX_NODE_ARTIFACT_BYTES,
      MAX_NODE_ARTIFACT_BYTES,
    );
    const staged: StagedArtifact[] = [];
    const replacements = new Map<string, CapabilityArtifactRef>();
    try {
      for (const [index, source] of sources.entries()) {
        if (source.byteSize < 1 || source.byteSize > maximumBytes) {
          throw new Error("NODE_CAPABILITY_ARTIFACT_SIZE_INVALID");
        }
        const bytes = await bridge.readCore({
          ownerId: context.ownerId,
          artifact: source,
          maximumBytes,
          signal: context.signal,
        });
        if (
          bytes.byteLength !== source.byteSize ||
          artifactDigest(bytes) !== source.digest
        ) {
          throw new Error("NODE_CAPABILITY_CORE_ARTIFACT_MISMATCH");
        }
        const node = await this.putStagedArtifact({
          context,
          staged,
          source,
          role: `input-${index}`,
          bytes,
          mimeType: source.mimeType,
        });
        replacements.set(artifactAuthority(source), node);
      }
      const rewritten = capabilityRequestSchemasFor(
        this.kind,
        rewriteArtifactRefs(input, replacements) as CapabilityRequestMap[K],
      );
      return {
        input: rewritten,
        artifacts: staged.map((entry) => entry.node),
        staged,
      };
    } catch (error) {
      const config = nodeConfig(this.connection.config);
      await this.cleanupArtifacts(
        context.ownerId,
        config.nodeId,
        staged.map((entry) => entry.node),
        "input",
      );
      throw error;
    }
  }

  private workerRequest(
    context: CapabilityAttemptContext,
    input: CapabilityRequestMap[K],
    source: CapabilityArtifactRef,
  ) {
    const branchId = `capability-${stableHash({
      operationId: context.operationId,
      source,
    }).slice(0, 48)}`;
    if (this.advertised.runtime.implementation === "artifact.local-ocr") {
      if (this.kind !== "document.ocr") {
        throw new Error("NODE_CAPABILITY_WORKER_KIND_MISMATCH");
      }
      const request = input as CapabilityRequestMap["document.ocr"];
      if (
        request.requestedFeatures.tables ||
        request.requestedFeatures.formulas ||
        request.requestedFeatures.images ||
        (request.pages?.length ?? 0) > 0 ||
        request.maximumPages > 1_000 ||
        request.pages?.some((page) => page > 1_000)
      ) {
        throw new Error("NODE_CAPABILITY_WORKER_REQUEST_UNSUPPORTED");
      }
      const codes: Readonly<Record<string, string>> = {
        en: "eng",
        fr: "fra",
        de: "deu",
        es: "spa",
        it: "ita",
        pt: "por",
        nl: "nld",
      };
      const languages = (request.languageHints ?? []).map((value) => {
        const normalized = value.toLowerCase().split("-")[0]!;
        const language = codes[normalized] ?? normalized;
        if (!/^[a-z]{3}$/u.test(language))
          throw new Error("NODE_CAPABILITY_WORKER_LANGUAGE_UNSUPPORTED");
        return language;
      });
      if (languages.length > 4)
        throw new Error("NODE_CAPABILITY_WORKER_LANGUAGE_UNSUPPORTED");
      return nodeArtifactWorkerRequestV1Schema.parse({
        schemaVersion: 1,
        worker: "local-ocr.v1",
        execution: { threadId: "capability-v1", branchId },
        inputs: [{ path: "input/source", artifact: source }],
        manifest: {
          schemaVersion: 1,
          worker: "local-ocr.v1",
          source: {
            path: "input/source",
            digest: source.digest,
            byteSize: source.byteSize,
            mimeType: source.mimeType,
          },
          language: languages.length > 0 ? languages.join("+") : "eng",
          maximumPages: request.maximumPages,
          maximumPixelsPerPage: 16_777_216,
          maximumTotalPixels: 1_000_000_000,
          modelId: this.advertised.descriptor.modelId,
          modelRevision: this.advertised.runtime.modelRevision,
        },
      });
    }
    if (
      this.advertised.runtime.implementation === "artifact.local-transcription"
    ) {
      if (this.kind !== "speech.transcribe") {
        throw new Error("NODE_CAPABILITY_WORKER_KIND_MISMATCH");
      }
      const request = input as CapabilityRequestMap["speech.transcribe"];
      if (
        request.timestamps === "word" ||
        request.diarization ||
        (request.vocabulary?.length ?? 0) > 0 ||
        !Number.isSafeInteger(request.maximumSeconds) ||
        request.maximumSeconds > 2 * 60 * 60
      ) {
        throw new Error("NODE_CAPABILITY_WORKER_REQUEST_UNSUPPORTED");
      }
      return nodeArtifactWorkerRequestV1Schema.parse({
        schemaVersion: 1,
        worker: "local-transcription.v1",
        execution: { threadId: "capability-v1", branchId },
        inputs: [{ path: "input/source", artifact: source }],
        manifest: {
          schemaVersion: 1,
          worker: "local-transcription.v1",
          source: {
            path: "input/source",
            digest: source.digest,
            byteSize: source.byteSize,
            mimeType: source.mimeType,
          },
          modelId: this.advertised.descriptor.modelId,
          modelRevision: this.advertised.runtime.modelRevision,
          ...(request.language ? { language: request.language } : {}),
          maximumSeconds: request.maximumSeconds,
          timestamps: "segment",
        },
      });
    }
    return null;
  }

  private signInvocation(input: {
    context: CapabilityAttemptContext;
    config: ReturnType<typeof nodeConfig>;
    request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1;
    inputArtifacts: CapabilityArtifactRef[];
    limits: NodeCapabilityExecutionLimits;
    deadline: Date;
    now: Date;
  }) {
    const issuedAt = input.now.toISOString();
    const claims: UnsignedNodeCapabilityInvocationGrantClaims = {
      schemaVersion: 1,
      issuer: "avermate-core",
      audience: input.config.nodeId,
      subject: input.context.ownerId,
      ownerId: input.context.ownerId,
      nodeId: input.config.nodeId,
      operationId: input.context.operationId,
      offeringId: input.request.offeringId,
      offeringDigest: input.request.offeringDigest,
      configRevision: input.request.configRevision,
      requestDigest: input.request.requestDigest,
      inputArtifacts: input.inputArtifacts,
      limits: input.limits,
      egressPolicyDigest: this.advertised.network.egressPolicyDigest,
      notBefore: issuedAt,
      expiresAt: input.deadline.toISOString(),
      issuedAt,
      jti: `nodecap_${crypto.randomUUID()}`,
    };
    return signedNodeCapabilityInvocationGrantSchema.parse(
      this.dependencies.signGrant(claims),
    );
  }

  private async invocation(
    context: CapabilityAttemptContext,
    raw: CapabilityRequestMap[K],
  ) {
    grantDeadline(context, this.dependencies.now());
    const staged = await this.stageInput(context, raw);
    const config = nodeConfig(this.connection.config);
    try {
      const now = this.dependencies.now();
      const deadline = grantDeadline(context, now);
      const source = staged.staged.find((entry) => entry.source !== null)?.node;
      const worker = source
        ? this.workerRequest(context, staged.input, source)
        : null;
      if (worker) {
        const bytes = new TextEncoder().encode(canonicalCapabilityJson(worker));
        const manifestArtifact = await this.putStagedArtifact({
          context,
          staged: staged.staged,
          source: null,
          role: "worker-manifest",
          bytes,
          mimeType: "application/json",
        });
        staged.artifacts.push(manifestArtifact);
        const limits = executionLimits({
          serializedInput: worker,
          artifacts: staged.artifacts,
          offering: this.offering,
          deadline,
          now,
        });
        const manifest = nodeCapabilityJobManifestV1Schema.parse({
          schemaVersion: 1,
          operationId: context.operationId,
          ownerId: context.ownerId,
          capability: this.kind,
          purpose: context.purpose,
          offeringId: this.advertised.descriptor.id,
          offeringDigest: this.advertised.descriptorDigest,
          configRevision: config.configRevision,
          inputs: staged.artifacts,
          requestJson: worker,
          requestDigest: capabilityDigest(worker),
          limits,
          egressPolicyDigest: this.advertised.network.egressPolicyDigest,
        });
        return {
          mode: "artifact-job" as const,
          config,
          request: manifest,
          originalInput: staged.input,
          limits,
          staged: staged.staged,
          grant: this.signInvocation({
            context,
            config,
            request: manifest,
            inputArtifacts: manifest.inputs,
            limits,
            deadline,
            now,
          }),
        };
      }

      const draft = nodeCapabilityRequestV1Schema.parse({
        schemaVersion: 1,
        operationId: context.operationId,
        ownerId: context.ownerId,
        capability: this.kind,
        purpose: context.purpose,
        offeringId: this.advertised.descriptor.id,
        offeringDigest: this.advertised.descriptorDigest,
        configRevision: config.configRevision,
        requestDigest: `sha256:${"0".repeat(64)}`,
        inputArtifacts: staged.artifacts,
        input: staged.input,
      });
      const request = nodeCapabilityRequestV1Schema.parse({
        ...draft,
        requestDigest: capabilityDigest(
          nodeCapabilityRequestDigestPayload(draft),
        ),
      });
      const limits = executionLimits({
        serializedInput: request,
        artifacts: request.inputArtifacts,
        offering: this.offering,
        deadline,
        now,
      });
      return {
        mode: "unary" as const,
        config,
        request,
        originalInput: staged.input,
        limits,
        staged: staged.staged,
        grant: this.signInvocation({
          context,
          config,
          request,
          inputArtifacts: request.inputArtifacts,
          limits,
          deadline,
          now,
        }),
      };
    } catch (error) {
      await this.cleanupArtifacts(
        context.ownerId,
        config.nodeId,
        staged.staged.map((entry) => entry.node),
        "input",
      );
      throw error;
    }
  }

  async invoke(
    context: CapabilityAttemptContext,
    raw: CapabilityRequestMap[K],
  ): Promise<CapabilityResultMap[K]> {
    const invocation = await this.invocation(context, raw);
    let dispatched = false;
    let providerReturned = false;
    try {
      await context.authorize();
      dispatched = true;
      const result =
        invocation.mode === "artifact-job"
          ? await this.invokeArtifactJob(context, invocation)
          : await this.dependencies.transport.invokeCapability({
              nodeId: invocation.config.nodeId,
              ownerId: context.ownerId,
              grant: invocation.grant,
              request: invocation.request,
              signal: context.signal,
            });
      providerReturned = true;
      const parsed = await this.validateResult({
        raw: result,
        request: invocation.request,
        originalInput: invocation.originalInput,
        limits: invocation.limits,
        nodeId: invocation.config.nodeId,
        signal: context.signal,
        worker: invocation.mode === "artifact-job",
        authorize: () => context.authorize(),
      });
      await this.cleanupArtifacts(
        context.ownerId,
        invocation.config.nodeId,
        invocation.staged.map((entry) => entry.node),
        "input",
      );
      return parsed;
    } catch (error) {
      // Once the relay has accepted dispatch, a transport failure is ambiguous:
      // retain deterministic staged inputs so the exact operation can replay.
      if (!dispatched || providerReturned) {
        await this.cleanupArtifacts(
          context.ownerId,
          invocation.config.nodeId,
          invocation.staged.map((entry) => entry.node),
          "input",
        );
      }
      if (dispatched && !providerReturned) {
        throw new CapabilityExecutionError(
          capabilityFailure(
            "PROVIDER_UNAVAILABLE",
            "Node invocation outcome is unknown; reconcile the exact operation before retrying",
            { ambiguous: true, retryable: false },
          ),
        );
      }
      throw error;
    }
  }

  private invokeArtifactJob(
    context: CapabilityAttemptContext,
    invocation: {
      config: ReturnType<typeof nodeConfig>;
      grant: SignedNodeCapabilityInvocationGrant;
      request: NodeCapabilityJobManifestV1;
    },
  ) {
    const dispatch = this.dependencies.transport.artifactJobCapability;
    if (!dispatch) {
      throw new Error("NODE_CAPABILITY_ARTIFACT_JOB_TRANSPORT_UNAVAILABLE");
    }
    return dispatch.call(this.dependencies.transport, {
      nodeId: invocation.config.nodeId,
      ownerId: context.ownerId,
      grant: invocation.grant,
      manifest: invocation.request,
      signal: context.signal,
    });
  }

  async *stream(
    context: CapabilityAttemptContext,
    raw: CapabilityRequestMap[K],
  ): AsyncIterable<NodeCapabilityEventV1 | ModelGatewayEvent> {
    const invocation = await this.invocation(context, raw);
    if (invocation.mode === "artifact-job") {
      await this.cleanupArtifacts(
        context.ownerId,
        invocation.config.nodeId,
        invocation.staged.map((entry) => entry.node),
        "input",
      );
      throw new Error("NODE_CAPABILITY_ARTIFACT_JOB_STREAM_UNSUPPORTED");
    }
    let dispatched = false;
    let completed = false;
    try {
      await context.authorize();
      dispatched = true;
      let previous = -1;
      for await (const rawEvent of this.dependencies.transport.streamCapability(
        {
          nodeId: invocation.config.nodeId,
          ownerId: context.ownerId,
          grant: invocation.grant,
          request: invocation.request,
          signal: context.signal,
        },
      )) {
        const event = nodeCapabilityEventV1Schema.parse(rawEvent);
        if (
          event.operationId !== context.operationId ||
          event.offeringId !== this.advertised.descriptor.id ||
          event.sequence !== previous + 1 ||
          completed
        ) {
          throw new Error("NODE_CAPABILITY_STREAM_BINDING_INVALID");
        }
        previous = event.sequence;
        if (collectArtifacts(event.payload, context.ownerId).length > 0) {
          throw new Error(
            "NODE_CAPABILITY_STREAM_OUTPUT_ARTIFACTS_UNSUPPORTED",
          );
        }
        const normalized =
          this.kind === "language.generate" ? nodeLanguageEvent(event) : event;
        completed = event.type === "completed";
        if (normalized) yield normalized;
      }
      if (!completed) throw new Error("NODE_CAPABILITY_STREAM_INCOMPLETE");
    } catch (error) {
      if (dispatched && !completed) {
        throw new CapabilityExecutionError(
          capabilityFailure(
            "PROVIDER_UNAVAILABLE",
            "Node stream outcome is unknown; reconcile the exact operation before retrying",
            { ambiguous: true, retryable: false },
          ),
        );
      }
      throw error;
    } finally {
      if (!dispatched || completed) {
        await this.cleanupArtifacts(
          context.ownerId,
          invocation.config.nodeId,
          invocation.staged.map((entry) => entry.node),
          "input",
        );
      }
    }
  }

  private async validateResult(input: {
    raw: NodeCapabilityResultV1;
    request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1;
    originalInput: CapabilityRequestMap[K];
    limits: NodeCapabilityExecutionLimits;
    nodeId: string;
    signal: AbortSignal;
    worker: boolean;
    authorize(): Promise<void>;
  }): Promise<CapabilityResultMap[K]> {
    const result = nodeCapabilityResultV1Schema.parse(input.raw);
    if (
      result.operationId !== input.request.operationId ||
      result.offeringId !== input.request.offeringId ||
      result.requestDigest !== input.request.requestDigest ||
      result.outputDigest !==
        capabilityDigest(nodeCapabilityResultDigestPayload(result)) ||
      result.outputArtifacts.some(
        (artifact) =>
          artifact.object.ownerId !== input.request.ownerId ||
          ![NODE_WORKER_OUTPUT_NAMESPACE, "capability-outputs"].includes(
            artifact.object.namespace,
          ) ||
          !artifact.object.key.startsWith(
            `${createHash("sha256").update(input.request.operationId).digest("hex")}/`,
          ),
      )
    ) {
      throw new Error("NODE_CAPABILITY_RESULT_BINDING_INVALID");
    }
    const outputBytes =
      new TextEncoder().encode(JSON.stringify(result.result)).byteLength +
      result.outputArtifacts.reduce(
        (total, artifact) => total + artifact.byteSize,
        0,
      );
    if (outputBytes > input.limits.outputBytes) {
      throw new Error("NODE_CAPABILITY_RESULT_AUTHORITY_INVALID");
    }
    if (input.worker) {
      return this.validateWorkerResult({ ...input, result });
    }

    const parsed = capabilityResultSchemas[this.kind].parse(
      result.result,
    ) as CapabilityResultMap[K];
    const outputArtifacts = collectArtifacts(parsed, input.request.ownerId);
    if (
      !exactArtifacts(outputArtifacts, result.outputArtifacts) ||
      canonicalCapabilityJson(
        (parsed as CapabilityResultMap[CapabilityKind]).usage,
      ) !== canonicalCapabilityJson(result.usage)
    ) {
      throw new Error("NODE_CAPABILITY_RESULT_AUTHORITY_INVALID");
    }
    const replacements = new Map<string, CapabilityArtifactRef>();
    for (const artifact of outputArtifacts) {
      if (
        artifact.byteSize < 1 ||
        artifact.byteSize > input.limits.outputBytes
      ) {
        throw new Error("NODE_CAPABILITY_OUTPUT_ARTIFACT_SIZE_INVALID");
      }
      const bridge = this.artifactBridge();
      const bytes = await bridge.readNode({
        nodeId: input.nodeId,
        ownerId: input.request.ownerId,
        artifact,
        maximumBytes: Math.min(
          input.limits.outputBytes,
          MAX_NODE_ARTIFACT_BYTES,
        ),
        signal: input.signal,
      });
      if (
        bytes.byteLength !== artifact.byteSize ||
        artifactDigest(bytes) !== artifact.digest
      ) {
        throw new Error("NODE_CAPABILITY_OUTPUT_ARTIFACT_MISMATCH");
      }
      assertOutputMime(artifact, bytes);
      const idempotencyKey = `capability-adopt-${stableHash({
        operationId: input.request.operationId,
        artifact,
      }).slice(0, 48)}`;
      await input.authorize();
      const adopted = capabilityArtifactRefSchema.parse(
        await bridge.adoptCore({
          nodeId: input.nodeId,
          ownerId: input.request.ownerId,
          operationId: input.request.operationId,
          artifact,
          bytes,
          idempotencyKey,
          signal: input.signal,
        }),
      );
      if (
        adopted.object.ownerId !== input.request.ownerId ||
        adopted.object.namespace !== "files" ||
        adopted.digest !== artifact.digest ||
        adopted.byteSize !== artifact.byteSize ||
        adopted.mimeType !== artifact.mimeType
      ) {
        throw new Error("NODE_CAPABILITY_ADOPTED_ARTIFACT_MISMATCH");
      }
      replacements.set(artifactAuthority(artifact), adopted);
    }
    const adoptedResult = capabilityResultSchemas[this.kind].parse(
      rewriteArtifactRefs(parsed, replacements),
    ) as CapabilityResultMap[K];
    await this.cleanupArtifacts(
      input.request.ownerId,
      input.nodeId,
      result.outputArtifacts,
      "output",
    );
    return this.withProviderRequestId(adoptedResult, result.providerRequestId);
  }

  private async validateWorkerResult(input: {
    result: NodeCapabilityResultV1;
    request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1;
    originalInput: CapabilityRequestMap[K];
    limits: NodeCapabilityExecutionLimits;
    nodeId: string;
    signal: AbortSignal;
  }) {
    if (!("inputs" in input.request)) {
      throw new Error("NODE_CAPABILITY_WORKER_ENVELOPE_INVALID");
    }
    const source = input.request.inputs.find(
      (artifact) => artifact.mimeType !== "application/json",
    );
    const outputs = input.result.outputArtifacts.filter(
      (artifact) => artifact.mimeType === "application/json",
    );
    if (
      !source ||
      outputs.length !== 1 ||
      input.result.outputArtifacts.length !== 1
    ) {
      throw new Error("NODE_CAPABILITY_WORKER_RESULT_MANIFEST_INVALID");
    }
    const output = outputs[0]!;
    const bytes = await this.artifactBridge().readNode({
      nodeId: input.nodeId,
      ownerId: input.request.ownerId,
      artifact: output,
      maximumBytes: Math.min(input.limits.outputBytes, MAX_NODE_ARTIFACT_BYTES),
      signal: input.signal,
    });
    if (
      bytes.byteLength !== output.byteSize ||
      artifactDigest(bytes) !== output.digest
    ) {
      throw new Error("NODE_CAPABILITY_OUTPUT_ARTIFACT_MISMATCH");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("NODE_CAPABILITY_WORKER_RESULT_MALFORMED");
    }
    let parsed: CapabilityResultMap[K];
    if (this.kind === "document.ocr") {
      const worker = localOcrWorkerOutputV1Schema.parse(raw);
      const request =
        input.originalInput as CapabilityRequestMap["document.ocr"];
      if (
        worker.sourceDigest !== source.digest ||
        worker.modelId !== this.advertised.descriptor.modelId ||
        worker.modelRevision !== this.advertised.runtime.modelRevision ||
        worker.networkAccess !== false ||
        worker.pageCount > request.maximumPages
      ) {
        throw new Error("NODE_CAPABILITY_WORKER_RESULT_FENCE_MISMATCH");
      }
      parsed = capabilityResultSchemas["document.ocr"].parse({
        schemaVersion: 1,
        pages: worker.pages.map((page) => ({
          page: page.providerIndex + 1,
          markdown: request.requestedFeatures.markdown ? page.markdown : null,
          plainText: page.markdown,
          blocks: request.requestedFeatures.blocks
            ? [
                {
                  id: `page-${page.providerIndex + 1}-content`,
                  kind: "paragraph",
                  text: page.markdown,
                  bbox: null,
                  confidence: null,
                  assetRef: null,
                },
              ]
            : [],
        })),
        pageCount: worker.pageCount,
        language: "unknown",
        usage: input.result.usage,
        providerMetadata: {
          worker: worker.worker,
          engine: worker.engine,
          modelRevision: worker.modelRevision,
        },
      }) as CapabilityResultMap[K];
    } else if (this.kind === "speech.transcribe") {
      const worker = localTranscriptionWorkerOutputV1Schema.parse(raw);
      const request =
        input.originalInput as CapabilityRequestMap["speech.transcribe"];
      if (
        worker.sourceDigest !== source.digest ||
        worker.modelId !== this.advertised.descriptor.modelId ||
        worker.modelRevision !== this.advertised.runtime.modelRevision ||
        worker.networkAccess !== false ||
        worker.durationMs > request.maximumSeconds * 1_000
      ) {
        throw new Error("NODE_CAPABILITY_WORKER_RESULT_FENCE_MISMATCH");
      }
      parsed = capabilityResultSchemas["speech.transcribe"].parse({
        schemaVersion: 1,
        text: worker.text,
        language: worker.language,
        durationSeconds: worker.durationMs / 1_000,
        segments:
          request.timestamps === "none"
            ? []
            : worker.segments.map((segment, index) => ({
                id: `segment-${index + 1}`,
                startMs: segment.startMs,
                endMs: segment.endMs,
                text: segment.text,
                speakerId: null,
                confidence: null,
              })),
        words: null,
        usage: input.result.usage,
        providerMetadata: {
          worker: worker.worker,
          engine: worker.engine,
          modelRevision: worker.modelRevision,
        },
      }) as CapabilityResultMap[K];
    } else {
      throw new Error("NODE_CAPABILITY_WORKER_KIND_UNSUPPORTED");
    }
    await this.cleanupArtifacts(
      input.request.ownerId,
      input.nodeId,
      input.result.outputArtifacts,
      "output",
    );
    return this.withProviderRequestId(parsed, input.result.providerRequestId);
  }

  private withProviderRequestId(
    parsed: CapabilityResultMap[K],
    providerRequestId: string | null,
  ) {
    if (!providerRequestId) return parsed;
    return capabilityResultSchemas[this.kind].parse({
      ...parsed,
      providerMetadata: {
        ...((parsed as CapabilityResultMap[CapabilityKind]).providerMetadata ??
          {}),
        providerRequestId,
      },
    }) as CapabilityResultMap[K];
  }
}

function capabilityRequestSchemasFor<K extends CapabilityKind>(
  kind: K,
  raw: CapabilityRequestMap[K],
) {
  return capabilityRequestSchemas[kind].parse(raw) as CapabilityRequestMap[K];
}

async function defaultDependencies(): Promise<CoreNodePluginDependencies> {
  const [services, artifactIo] = await Promise.all([
    import("../../node/services"),
    import("../artifact-io"),
  ]);
  const stream = (bytes: Uint8Array) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  return {
    transport: services.relayNodeProviderTransport,
    signGrant: (claims) =>
      services.coreNodeGrantIssuer.signCapabilityInvocation(claims),
    now: () => new Date(),
    artifacts: {
      readCore: (input) =>
        artifactIo.coreCapabilityArtifactIo.read(
          input.ownerId,
          input.artifact,
          {
            maximumBytes: input.maximumBytes,
            signal: input.signal,
          },
        ),
      async putNode(input) {
        input.signal.throwIfAborted();
        const provider = await services.createPairedNodeObjectStorageProvider({
          ownerId: input.ownerId,
          nodeId: input.nodeId,
        });
        const committed = await provider.put({
          ref: input.artifact.object,
          body: stream(input.bytes),
          byteSize: input.artifact.byteSize,
          mimeType: input.artifact.mimeType,
          expectedDigest: input.artifact.digest,
          idempotencyKey: input.idempotencyKey,
        });
        input.signal.throwIfAborted();
        return {
          artifact: capabilityArtifactRefSchema.parse({
            object: committed.ref,
            digest: committed.digest,
            byteSize: committed.byteSize,
            mimeType: committed.mimeType,
          }),
          replayed: committed.replayed,
        };
      },
      async readNode(input) {
        return (
          await services.readPairedNodeArtifact({
            ownerId: input.ownerId,
            nodeId: input.nodeId,
            artifact: input.artifact,
            maxBytes: Math.min(
              input.maximumBytes,
              services.MAX_NODE_ARTIFACT_ADOPTION_BYTES,
            ),
            signal: input.signal,
          })
        ).bytes;
      },
      async adoptCore(input) {
        return artifactIo.coreCapabilityArtifactIo.adopt({
          ownerId: input.ownerId,
          operationId: input.operationId,
          idempotencyKey: input.idempotencyKey,
          artifact: input.artifact,
          bytes: input.bytes,
          signal: input.signal,
        });
      },
      async deleteNode(input) {
        const provider = await services.createPairedNodeObjectStorageProvider({
          ownerId: input.ownerId,
          nodeId: input.nodeId,
        });
        await provider.delete({
          ref: input.artifact.object,
          expectedDigest: input.artifact.digest,
          idempotencyKey: input.idempotencyKey,
        });
      },
    },
  };
}

export class CoreNodeProviderPlugin implements ProviderPlugin {
  constructor(
    readonly manifest: ProviderPluginManifest,
    private readonly resolveDependencies: DependencyResolver = defaultDependencies,
  ) {}

  async validateConnection(
    context: Parameters<ProviderPlugin["validateConnection"]>[0],
    config: unknown,
  ) {
    try {
      const parsed = nodeConfig(config);
      const dependencies = await this.resolveDependencies();
      context.signal.throwIfAborted();
      if (!(await dependencies.transport.online(parsed.nodeId))) {
        throw new Error("NODE_CAPABILITY_OFFLINE");
      }
      const offerings = await dependencies.transport.listCapabilityOfferings({
        nodeId: parsed.nodeId,
        ownerId: context.ownerId,
      });
      for (const offering of offerings) checkedNodeOffering(offering, parsed);
      return {
        valid: true as const,
        safeMetadata: {
          nodeId: parsed.nodeId,
          configRevision: parsed.configRevision,
          offeringCount: offerings.length,
        },
      };
    } catch (error) {
      return {
        valid: false as const,
        error: {
          version: 1 as const,
          code: "CAPABILITY_UNAVAILABLE" as const,
          message:
            error instanceof Error
              ? error.message.slice(0, 1_024)
              : "Node capability validation failed",
          retryable: true,
          ambiguous: false,
          providerRequestId: null,
          safeDiagnostic: null,
        },
      };
    }
  }

  async discoverOfferings(
    context: Parameters<ProviderPlugin["discoverOfferings"]>[0],
    connection: ProviderConnectionPublicSnapshot,
  ) {
    const config = assertConnection(connection, this.manifest);
    const dependencies = await this.resolveDependencies();
    context.signal.throwIfAborted();
    const advertised = await dependencies.transport.listCapabilityOfferings({
      nodeId: config.nodeId,
      ownerId: context.ownerId,
    });
    return advertised.map((offering) =>
      bridgeNodeCapabilityOffering({
        advertised: checkedNodeOffering(offering, config),
        connection,
        manifest: this.manifest,
      }),
    );
  }

  async createAdapter<K extends CapabilityKind>(
    context: Parameters<ProviderPlugin["createAdapter"]>[0],
    offering: CapabilityOfferingSnapshot<K>,
  ): Promise<CapabilityAdapter<K>> {
    const config = assertConnection(context.connection, this.manifest);
    const dependencies = await this.resolveDependencies();
    context.signal.throwIfAborted();
    const advertised = await dependencies.transport.listCapabilityOfferings({
      nodeId: config.nodeId,
      ownerId: context.ownerId,
    });
    const matches = advertised.filter((candidate) => {
      try {
        return (
          canonicalCapabilityJson(
            bridgeNodeCapabilityOffering({
              advertised: checkedNodeOffering(candidate, config),
              connection: context.connection,
              manifest: this.manifest,
            }),
          ) === canonicalCapabilityJson(offering)
        );
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) {
      throw new Error("NODE_CAPABILITY_OFFERING_UNAVAILABLE");
    }
    return new CoreNodeCapabilityAdapter(
      capabilityOfferingSchema.parse(offering) as CapabilityOfferingSnapshot<K>,
      checkedNodeOffering(matches[0]!, config),
      context.connection,
      dependencies,
    );
  }
}

export function createCoreNodeProviderPlugin(
  manifest: ProviderPluginManifest,
  dependencies?: CoreNodePluginDependencies,
) {
  return new CoreNodeProviderPlugin(
    manifest,
    dependencies ? async () => dependencies : defaultDependencies,
  );
}
