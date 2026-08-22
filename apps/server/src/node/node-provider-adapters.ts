import {
  avermateAgentEventV1Schema,
  conversationRunRecordSchema,
  getConversationRunSchema,
  lexicalCandidateSchema,
  modelAccessContextSchema,
  modelDescriptorSchema,
  ownedLexicalQuerySchema,
  replayConversationEventsSchema,
  sandboxCapabilitiesSchema,
  sandboxFileManifestEntrySchema,
  sandboxHandleSchema,
  sandboxPreflightResultSchema,
  sandboxRuntimeCheckpointCapabilitiesSchema,
  sandboxRuntimeCheckpointCompatibilityV1Schema,
  sandboxRuntimeCheckpointRefV1Schema,
  sandboxWorkspaceSnapshotRefSchema,
  storedConversationEventSchema,
  type AppendConversationEvent,
  type ConversationRunRecord,
  type ConversationStore,
  type EmbedRequest,
  type EmbedResult,
  type GetConversationRun,
  type LexicalCandidate,
  type LexicalConsistencyReport,
  type LexicalSearchBackend,
  type LexicalSearchCapabilities,
  type LexicalVersionInput,
  type ModelAccessContext,
  type ModelDescriptor,
  type ModelGateway,
  type ModelGatewayEvent,
  type ModelRequest,
  type NodeConversationTransport,
  type NodeLexicalSearchTransport,
  type NodeModelGatewayTransport,
  type NodeSandboxTransport,
  type NormalizedUsage,
  type OwnedLexicalQuery,
  type ReplayConversationEvents,
  type SandboxCapabilities,
  type SandboxCreateInput,
  type SandboxExecuteInput,
  type SandboxExecutionEvent,
  type SandboxFileManifestEntry,
  type SandboxHandle,
  type SandboxInputFile,
  type SandboxPreflightInput,
  type SandboxPreflightResult,
  type SandboxProvider,
  type SandboxProviderId,
  type SandboxRuntimeCheckpointCapabilities,
  type SandboxRuntimeCheckpointCompatibilityV1,
  type SandboxRuntimeCheckpointRefV1,
  type SandboxWorkspaceSnapshotRef,
  type StoredConversationEvent,
  type TranscriptionRequest,
  type TranscriptionResult,
  type UsageEstimate,
} from "@avermate/agent-contracts";
import { NodeCapabilityUnavailableError } from "./fail-closed-adapters";

const LEXICAL_MODES = new Set(["terms", "phrase", "prefix", "exact"]);
const MAX_MODEL_STREAM_EVENTS = 100_000;
const MAX_MODEL_DELTA_CHARS = 256 * 1024;

async function requireOnline(
  transport: { online(nodeId: string): Promise<boolean> },
  nodeId: string,
  capability: string,
) {
  if (!(await transport.online(nodeId))) {
    throw new NodeCapabilityUnavailableError(
      `NODE_${capability.toUpperCase()}_UNAVAILABLE`,
    );
  }
}

function assertOwner(expected: string, actual: string) {
  if (actual !== expected) throw new Error("NODE_CAPABILITY_OWNER_MISMATCH");
}

function sameEvent(
  expected: AppendConversationEvent["event"],
  stored: StoredConversationEvent,
) {
  const { persistedAt: _persistedAt, ...event } = stored;
  return JSON.stringify(event) === JSON.stringify(expected);
}

/** Core-side ConversationStore facade over an authenticated node transport. */
export class NodeConversationStore implements ConversationStore {
  constructor(
    readonly nodeId: string,
    readonly ownerId: string,
    private readonly transport: NodeConversationTransport,
  ) {}

  async appendEvent(
    input: AppendConversationEvent,
  ): Promise<StoredConversationEvent> {
    await requireOnline(this.transport, this.nodeId, "conversations");
    if (
      !Number.isSafeInteger(input.expectedPreviousSequence) ||
      input.expectedPreviousSequence < 0
    ) {
      throw new Error("NODE_CONVERSATION_SEQUENCE_INVALID");
    }
    const event = avermateAgentEventV1Schema.parse(input.event);
    const stored = storedConversationEventSchema.parse(
      await this.transport.appendConversationEvent({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        event: {
          event,
          expectedPreviousSequence: input.expectedPreviousSequence,
        },
      }),
    );
    if (!sameEvent(event, stored)) {
      throw new Error("NODE_CONVERSATION_EVENT_MISMATCH");
    }
    return stored;
  }

  async *replayEvents(
    input: ReplayConversationEvents,
  ): AsyncIterable<StoredConversationEvent> {
    const replay = replayConversationEventsSchema.parse(input);
    assertOwner(this.ownerId, replay.ownerId);
    await requireOnline(this.transport, this.nodeId, "conversations");
    let previous = replay.afterSequence;
    let count = 0;
    let terminal = false;
    for await (const raw of this.transport.replayConversationEvents({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      replay,
    })) {
      const event = storedConversationEventSchema.parse(raw);
      if (
        event.threadId !== replay.threadId ||
        event.branchId !== replay.branchId ||
        event.runId !== replay.runId ||
        event.sequence !== previous + 1 ||
        terminal
      ) {
        throw new Error("NODE_CONVERSATION_REPLAY_MISMATCH");
      }
      count += 1;
      if (count > replay.limit) {
        throw new Error("NODE_CONVERSATION_REPLAY_OVERFLOW");
      }
      previous = event.sequence;
      terminal = event.terminal;
      yield event;
    }
  }

  async getRun(
    input: GetConversationRun,
  ): Promise<ConversationRunRecord | null> {
    const requested = getConversationRunSchema.parse(input);
    if (requested.ownerId !== this.ownerId) return null;
    await requireOnline(this.transport, this.nodeId, "conversations");
    const raw = await this.transport.getConversationRun({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      run: requested,
    });
    if (raw === null) return null;
    const run = conversationRunRecordSchema.parse(raw);
    if (
      run.ownerId !== requested.ownerId ||
      run.threadId !== requested.threadId ||
      run.branchId !== requested.branchId ||
      run.runId !== requested.runId ||
      run.placement.kind !== "node" ||
      run.placement.nodeId !== this.nodeId
    ) {
      throw new Error("NODE_CONVERSATION_RUN_MISMATCH");
    }
    return run;
  }
}

function validateLexicalCapabilities(
  raw: LexicalSearchCapabilities,
): LexicalSearchCapabilities {
  const modes = [...raw.modes];
  if (
    !raw.available ||
    !raw.implementation ||
    modes.some((mode) => !LEXICAL_MODES.has(mode)) ||
    !modes.includes("terms") ||
    !modes.includes("exact")
  ) {
    return {
      available: false,
      implementation: raw.implementation || "node-lexical-unavailable",
      modes: [],
    };
  }
  return { available: true, implementation: raw.implementation, modes };
}

/**
 * Owner-bound lexical facade. The binding closes the ownership hole in the
 * provider's removeVersion/verify methods, whose legacy signatures lack an
 * owner identifier.
 */
export class NodeLexicalSearchBackend implements LexicalSearchBackend {
  constructor(
    readonly nodeId: string,
    readonly ownerId: string,
    private readonly transport: NodeLexicalSearchTransport,
  ) {}

  async capabilities(): Promise<LexicalSearchCapabilities> {
    if (!(await this.transport.online(this.nodeId))) {
      return {
        available: false,
        implementation: "node-offline",
        modes: [],
      };
    }
    return validateLexicalCapabilities(
      await this.transport.lexicalCapabilities({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
      }),
    );
  }

  async #requireConformant() {
    if (!(await this.capabilities()).available) {
      throw new NodeCapabilityUnavailableError(
        "NODE_LEXICAL_BACKEND_NOT_CONFORMANT",
      );
    }
  }

  async upsertVersion(input: LexicalVersionInput): Promise<void> {
    assertOwner(this.ownerId, input.ownerId);
    assertOwner(this.ownerId, input.source.ownerId);
    await this.#requireConformant();
    await this.transport.upsertLexicalVersion({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      version: input,
    });
  }

  async removeVersion(versionId: string): Promise<void> {
    await this.#requireConformant();
    await this.transport.removeLexicalVersion({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      versionId,
    });
  }

  async search(input: OwnedLexicalQuery): Promise<LexicalCandidate[]> {
    const query = ownedLexicalQuerySchema.parse(input);
    assertOwner(this.ownerId, query.ownerId);
    await this.#requireConformant();
    const candidates = await this.transport.searchLexical({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      query,
    });
    if (candidates.length > query.limit) {
      throw new Error("NODE_LEXICAL_RESULT_OVERFLOW");
    }
    return candidates.map((candidate) =>
      lexicalCandidateSchema.parse(candidate),
    );
  }

  async verify(): Promise<LexicalConsistencyReport> {
    await this.#requireConformant();
    const report = await this.transport.verifyLexical({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
    });
    if (
      !Number.isSafeInteger(report.indexedVersions) ||
      report.indexedVersions < 0 ||
      !Array.isArray(report.missingVersionIds) ||
      !Array.isArray(report.orphanedVersionIds)
    ) {
      throw new Error("NODE_LEXICAL_VERIFY_INVALID");
    }
    return report;
  }
}

function assertUsage(usage: NormalizedUsage) {
  for (const value of Object.values(usage)) {
    if (
      value !== "unknown" &&
      (!Number.isSafeInteger(value) || (value as number) < 0)
    ) {
      throw new Error("NODE_MODEL_USAGE_INVALID");
    }
  }
}

function assertModelEvent(raw: ModelGatewayEvent): ModelGatewayEvent {
  switch (raw.type) {
    case "content-delta":
    case "tool-arguments-delta":
      if (raw.delta.length > MAX_MODEL_DELTA_CHARS) {
        throw new Error("NODE_MODEL_STREAM_FRAME_TOO_LARGE");
      }
      break;
    case "usage":
      assertUsage(raw.usage);
      break;
    case "tool-call-start":
      if (!raw.callId || !raw.toolName)
        throw new Error("NODE_MODEL_EVENT_INVALID");
      break;
    case "tool-call-end":
      if (!raw.callId) throw new Error("NODE_MODEL_EVENT_INVALID");
      break;
    case "reasoning-summary":
      if (raw.providerAuthorized !== true) {
        throw new Error("NODE_MODEL_REASONING_NOT_AUTHORIZED");
      }
      break;
    case "opaque-reasoning-state":
      if (!raw.continuationRef) throw new Error("NODE_MODEL_EVENT_INVALID");
      break;
    case "finish":
    case "error":
      break;
  }
  return raw;
}

function assertSandboxExecutionEvent(
  raw: SandboxExecutionEvent,
): SandboxExecutionEvent {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string") {
    throw new Error("NODE_SANDBOX_EVENT_INVALID");
  }

  switch (raw.type) {
    case "started":
      if (!Number.isFinite(Date.parse(raw.at))) {
        throw new Error("NODE_SANDBOX_EVENT_INVALID");
      }
      break;
    case "stdout":
    case "stderr":
      if (
        typeof raw.chunk !== "string" ||
        raw.chunk.length > MAX_MODEL_DELTA_CHARS ||
        typeof raw.truncated !== "boolean"
      ) {
        throw new Error("NODE_SANDBOX_EVENT_INVALID");
      }
      break;
    case "progress":
      if (
        !Number.isFinite(raw.current) ||
        !Number.isFinite(raw.total) ||
        raw.current < 0 ||
        raw.total <= 0 ||
        raw.current > raw.total
      ) {
        throw new Error("NODE_SANDBOX_EVENT_INVALID");
      }
      break;
    case "exited":
      if (
        !Number.isFinite(Date.parse(raw.at)) ||
        !Number.isInteger(raw.exitCode) ||
        !Number.isSafeInteger(raw.outputBytes) ||
        raw.outputBytes < 0
      ) {
        throw new Error("NODE_SANDBOX_EVENT_INVALID");
      }
      break;
  }

  return raw;
}

/** Core-side ModelGateway facade restricted to manifest-tested node models. */
export class NodeModelGateway implements ModelGateway {
  readonly #models = new Map<string, ModelDescriptor>();

  constructor(
    readonly nodeId: string,
    readonly ownerId: string,
    models: readonly ModelDescriptor[],
    private readonly transport: NodeModelGatewayTransport,
  ) {
    for (const raw of models) {
      const model = modelDescriptorSchema.parse(raw);
      if (this.#models.has(model.id))
        throw new Error("NODE_MODEL_ID_DUPLICATE");
      this.#models.set(model.id, model);
    }
  }

  #requestOwner(ownerId: string) {
    assertOwner(this.ownerId, ownerId);
  }

  #requireModel(modelId: string) {
    if (!this.#models.has(modelId)) {
      throw new NodeCapabilityUnavailableError(
        "NODE_MODEL_NOT_ADVERTISED",
        false,
      );
    }
  }

  async listModels(context: ModelAccessContext): Promise<ModelDescriptor[]> {
    const requested = modelAccessContextSchema.parse(context);
    this.#requestOwner(requested.ownerId);
    if (
      requested.placement !== "node" &&
      requested.placement !== "full-self-host"
    ) {
      throw new Error("NODE_MODEL_PLACEMENT_MISMATCH");
    }
    await requireOnline(this.transport, this.nodeId, "models");
    const returned = await this.transport.listNodeModels({
      nodeId: this.nodeId,
      context: requested,
    });
    const seen = new Set<string>();
    return returned.map((raw) => {
      const model = modelDescriptorSchema.parse(raw);
      const advertised = this.#models.get(model.id);
      if (
        seen.has(model.id) ||
        !advertised ||
        JSON.stringify(advertised) !== JSON.stringify(model)
      ) {
        throw new Error("NODE_MODEL_MANIFEST_MISMATCH");
      }
      seen.add(model.id);
      return model;
    });
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelGatewayEvent> {
    this.#requestOwner(request.ownerId);
    this.#requireModel(request.modelId);
    await requireOnline(this.transport, this.nodeId, "models");
    let count = 0;
    let terminal = false;
    for await (const event of this.transport.streamNodeModel({
      nodeId: this.nodeId,
      request,
    })) {
      count += 1;
      if (count > MAX_MODEL_STREAM_EVENTS) {
        throw new Error("NODE_MODEL_STREAM_OVERFLOW");
      }
      if (terminal) throw new Error("NODE_MODEL_EVENT_AFTER_TERMINAL");
      const parsed = assertModelEvent(event);
      terminal = parsed.type === "finish" || parsed.type === "error";
      yield parsed;
    }
    if (!terminal) throw new Error("NODE_MODEL_STREAM_TRUNCATED");
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    this.#requestOwner(request.ownerId);
    this.#requireModel(request.modelId);
    await requireOnline(this.transport, this.nodeId, "models");
    const result = await this.transport.embedWithNodeModel({
      nodeId: this.nodeId,
      request,
    });
    if (
      result.vectors.length !== request.inputs.length ||
      result.vectors.some(
        (vector) =>
          vector.length === 0 ||
          vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new Error("NODE_MODEL_EMBEDDING_INVALID");
    }
    assertUsage(result.usage);
    return result;
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    this.#requestOwner(request.ownerId);
    this.#requireModel(request.modelId);
    await requireOnline(this.transport, this.nodeId, "models");
    const result = await this.transport.transcribeWithNodeModel({
      nodeId: this.nodeId,
      request,
    });
    if (!result.text || !result.language) {
      throw new Error("NODE_MODEL_TRANSCRIPTION_INVALID");
    }
    assertUsage(result.usage);
    return result;
  }

  async estimate(request: ModelRequest): Promise<UsageEstimate> {
    this.#requestOwner(request.ownerId);
    this.#requireModel(request.modelId);
    await requireOnline(this.transport, this.nodeId, "models");
    const result = await this.transport.estimateNodeModel({
      nodeId: this.nodeId,
      request,
    });
    assertUsage(result.usage);
    return result;
  }
}

/** Core-side SandboxProvider facade, owner-bound and handle-fenced. */
export class NodeSandboxProvider implements SandboxProvider {
  readonly #handles = new Map<string, string>();

  constructor(
    readonly nodeId: string,
    readonly ownerId: string,
    readonly id: SandboxProviderId,
    private readonly transport: NodeSandboxTransport,
  ) {}

  async capabilities(): Promise<SandboxCapabilities> {
    if (!(await this.transport.online(this.nodeId))) {
      return { providerId: this.id, available: false, profiles: [] };
    }
    const capabilities = sandboxCapabilitiesSchema.parse(
      await this.transport.sandboxCapabilities({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
      }),
    );
    if (capabilities.providerId !== this.id) {
      throw new Error("NODE_SANDBOX_PROVIDER_MISMATCH");
    }
    return capabilities;
  }

  async preflight(
    input: SandboxPreflightInput,
  ): Promise<SandboxPreflightResult> {
    if (!(await this.transport.online(this.nodeId))) {
      return {
        ok: false,
        reason: "TRANSPORT_UNAVAILABLE",
        message: "The paired node is offline; no sandbox was created.",
      };
    }
    return sandboxPreflightResultSchema.parse(
      await this.transport.preflightSandbox({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
        preflight: input,
      }),
    );
  }

  #assertHandle(handle: SandboxHandle) {
    const parsed = sandboxHandleSchema.parse(handle);
    if (
      parsed.ownerId !== this.ownerId ||
      parsed.providerId !== this.id ||
      this.#handles.get(parsed.sandboxId) !== JSON.stringify(parsed)
    ) {
      throw new Error("NODE_SANDBOX_HANDLE_MISMATCH");
    }
  }

  #acceptHandle(raw: SandboxHandle) {
    const handle = sandboxHandleSchema.parse(raw);
    if (handle.ownerId !== this.ownerId || handle.providerId !== this.id) {
      throw new Error("NODE_SANDBOX_HANDLE_MISMATCH");
    }
    this.#handles.set(handle.sandboxId, JSON.stringify(handle));
    return handle;
  }

  async create(input: SandboxCreateInput): Promise<SandboxHandle> {
    assertOwner(this.ownerId, input.ownerId);
    await requireOnline(this.transport, this.nodeId, "sandbox");
    return this.#acceptHandle(
      await this.transport.createSandbox({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
        create: input,
      }),
    );
  }

  async *execute(
    input: SandboxExecuteInput,
  ): AsyncIterable<SandboxExecutionEvent> {
    this.#assertHandle(input.handle);
    await requireOnline(this.transport, this.nodeId, "sandbox");
    let terminal = false;
    for await (const event of this.transport.executeSandbox({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      providerId: this.id,
      execute: input,
    })) {
      if (terminal) throw new Error("NODE_SANDBOX_EVENT_AFTER_TERMINAL");
      const parsed = assertSandboxExecutionEvent(event);
      terminal = parsed.type === "exited";
      yield parsed;
    }
    if (!terminal) throw new Error("NODE_SANDBOX_STREAM_TRUNCATED");
  }

  async putFiles(
    handle: SandboxHandle,
    files: readonly SandboxInputFile[],
  ): Promise<void> {
    this.#assertHandle(handle);
    await requireOnline(this.transport, this.nodeId, "sandbox");
    await this.transport.putSandboxFiles({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      providerId: this.id,
      handle,
      files,
    });
  }

  async getFiles(
    handle: SandboxHandle,
    paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]> {
    this.#assertHandle(handle);
    await requireOnline(this.transport, this.nodeId, "sandbox");
    return (
      await this.transport.getSandboxFiles({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
        handle,
        paths,
      })
    ).map((entry) => sandboxFileManifestEntrySchema.parse(entry));
  }

  async *readFile(
    handle: SandboxHandle,
    relativePath: string,
  ): AsyncIterable<Uint8Array> {
    this.#assertHandle(handle);
    await requireOnline(this.transport, this.nodeId, "sandbox");
    for await (const chunk of this.transport.readSandboxFile({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      providerId: this.id,
      handle,
      relativePath,
    })) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error("NODE_SANDBOX_FILE_CHUNK_INVALID");
      }
      yield chunk;
    }
  }

  async snapshotWorkspace(
    handle: SandboxHandle,
  ): Promise<SandboxWorkspaceSnapshotRef> {
    this.#assertHandle(handle);
    await requireOnline(this.transport, this.nodeId, "sandbox");
    const snapshot = sandboxWorkspaceSnapshotRefSchema.parse(
      await this.transport.snapshotNodeWorkspace({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
        handle,
      }),
    );
    if (snapshot.provider !== this.id) {
      throw new Error("NODE_SANDBOX_SNAPSHOT_MISMATCH");
    }
    return snapshot;
  }

  async forkWorkspace(
    input: SandboxCreateInput & { source: SandboxWorkspaceSnapshotRef },
  ): Promise<SandboxHandle> {
    assertOwner(this.ownerId, input.ownerId);
    if (input.source.provider !== this.id) {
      throw new Error("NODE_SANDBOX_SNAPSHOT_MISMATCH");
    }
    await requireOnline(this.transport, this.nodeId, "sandbox");
    return this.#acceptHandle(
      await this.transport.forkNodeWorkspace({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
        create: input,
      }),
    );
  }

  async runtimeCheckpointCapabilities(): Promise<SandboxRuntimeCheckpointCapabilities> {
    await requireOnline(this.transport, this.nodeId, "sandbox");
    const capabilities = sandboxRuntimeCheckpointCapabilitiesSchema.parse(
      await this.transport.sandboxRuntimeCheckpointCapabilities({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
      }),
    );
    if (capabilities.available && capabilities.provider !== this.id) {
      throw new Error("NODE_SANDBOX_RUNTIME_CHECKPOINT_PROVIDER_MISMATCH");
    }
    return capabilities;
  }

  async captureRuntimeCheckpoint(input: {
    handle: SandboxHandle;
    sourceWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    compatibility: SandboxRuntimeCheckpointCompatibilityV1;
    idempotencyKey: string;
    expiresAt: Date;
  }): Promise<SandboxRuntimeCheckpointRefV1> {
    this.#assertHandle(input.handle);
    const source = sandboxWorkspaceSnapshotRefSchema.parse(
      input.sourceWorkspaceSnapshot,
    );
    const compatibility = sandboxRuntimeCheckpointCompatibilityV1Schema.parse(
      input.compatibility,
    );
    if (
      source.provider !== this.id ||
      compatibility.provider !== this.id ||
      compatibility.profileId !== input.handle.profileId ||
      compatibility.profileVersion !== input.handle.profileVersion ||
      compatibility.imageDigest !== input.handle.image.imageDigest
    ) {
      throw new Error("NODE_SANDBOX_RUNTIME_CHECKPOINT_COMPATIBILITY_MISMATCH");
    }
    if (!Number.isFinite(input.expiresAt.getTime())) {
      throw new Error("NODE_SANDBOX_RUNTIME_CHECKPOINT_EXPIRY_INVALID");
    }
    await requireOnline(this.transport, this.nodeId, "sandbox");
    const checkpoint = sandboxRuntimeCheckpointRefV1Schema.parse(
      await this.transport.captureSandboxRuntimeCheckpoint({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
        handle: input.handle,
        sourceWorkspaceSnapshot: source,
        compatibility,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt.toISOString(),
      }),
    );
    if (
      checkpoint.captureState !== "captured" ||
      checkpoint.adoptedObjectRefs.length !== 0 ||
      checkpoint.captureIdempotencyKey !== input.idempotencyKey ||
      JSON.stringify(checkpoint.compatibility) !==
        JSON.stringify(compatibility) ||
      JSON.stringify(checkpoint.sourceWorkspaceSnapshot) !==
        JSON.stringify(source)
    ) {
      throw new Error("NODE_SANDBOX_RUNTIME_CHECKPOINT_RESPONSE_MISMATCH");
    }
    return checkpoint;
  }

  async restoreRuntimeCheckpoint(input: {
    create: SandboxCreateInput;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }): Promise<SandboxHandle> {
    assertOwner(this.ownerId, input.create.ownerId);
    const checkpoint = sandboxRuntimeCheckpointRefV1Schema.parse(
      input.checkpoint,
    );
    if (
      checkpoint.checkpoint.provider !== this.id ||
      checkpoint.compatibility.provider !== this.id ||
      checkpoint.sourceWorkspaceSnapshot.provider !== this.id ||
      checkpoint.compatibility.profileId !== input.create.profile.id ||
      checkpoint.compatibility.profileVersion !==
        input.create.profile.version ||
      checkpoint.compatibility.imageDigest !==
        input.create.profile.image.imageDigest
    ) {
      throw new Error("NODE_SANDBOX_RUNTIME_CHECKPOINT_COMPATIBILITY_MISMATCH");
    }
    await requireOnline(this.transport, this.nodeId, "sandbox");
    return this.#acceptHandle(
      await this.transport.restoreSandboxRuntimeCheckpoint({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        providerId: this.id,
        create: input.create,
        checkpoint,
      }),
    );
  }

  async deleteRuntimeCheckpoint(
    checkpointValue: SandboxRuntimeCheckpointRefV1,
  ): Promise<void> {
    const checkpoint =
      sandboxRuntimeCheckpointRefV1Schema.parse(checkpointValue);
    if (
      checkpoint.checkpoint.provider !== this.id ||
      checkpoint.compatibility.provider !== this.id ||
      checkpoint.sourceWorkspaceSnapshot.provider !== this.id
    ) {
      throw new Error("NODE_SANDBOX_RUNTIME_CHECKPOINT_PROVIDER_MISMATCH");
    }
    await requireOnline(this.transport, this.nodeId, "sandbox");
    await this.transport.deleteSandboxRuntimeCheckpoint({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      providerId: this.id,
      checkpoint,
    });
  }

  async stop(handle: SandboxHandle): Promise<void> {
    this.#assertHandle(handle);
    await requireOnline(this.transport, this.nodeId, "sandbox");
    await this.transport.stopSandbox({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      providerId: this.id,
      handle,
    });
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    this.#assertHandle(handle);
    await requireOnline(this.transport, this.nodeId, "sandbox");
    await this.transport.destroySandbox({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      providerId: this.id,
      handle,
    });
    this.#handles.delete(handle.sandboxId);
  }
}
