import type {
  ConversationStore,
  ConversationRunRecord,
  LexicalSearchBackend,
  ModelGateway,
  NodeConversationTransport,
  NodeLexicalSearchTransport,
  NodeModelGatewayTransport,
  NodeObjectReadTransport,
  NodeDeletionManifest,
  NodeDeletionReceipt,
  NodeProviderFetchRequest,
  NodeProviderFetchResponse,
  NodeProviderHttpTransport,
  NodeSandboxTransport,
  ObjectStorageCopyInput,
  ObjectStorageDeleteInput,
  ObjectStorageGetInput,
  ObjectStorageRangeInput,
  ObjectStorageReconcileInput,
  ObjectStorageProvider,
  ObjectStoragePutInput,
  ObjectStorageStatInput,
  ObjectTransferGrantInput,
  MultipartAbortInput,
  MultipartBeginInput,
  MultipartCompleteInput,
  MultipartPartInput,
  SandboxProvider,
  SandboxProviderId,
  NodeConversationDagSnapshot,
  NodeConversationDagListInput,
  NodeConversationDagGetResult,
  AssistantThreadListItem,
} from "@avermate/agent-contracts";
import type { NodeIdentity } from "./identity";
import { executeDeletionManifest } from "./deletion";
import type { LocalNodeMcpTransport } from "./mcp-transport";

type OwnerResolver<T> = (ownerId: string) => T | null;
type NodeConversationProvider = ConversationStore & {
  provisionRun(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    runId: string;
    placement: Parameters<
      NonNullable<NodeConversationTransport["provisionConversationRun"]>
    >[0]["run"]["placement"];
  }): Promise<ConversationRunRecord>;
  exportOwner(ownerId: string): Promise<unknown>;
  deleteOwner(
    ownerId: string,
  ): Promise<{ deletedRuns: number; deletedEvents: number }>;
  importDag(
    input: NodeConversationDagSnapshot,
  ): Promise<NodeConversationDagSnapshot>;
  listDags(
    ownerId: string,
    input: NodeConversationDagListInput,
  ): Promise<AssistantThreadListItem[]>;
  getDag(
    ownerId: string,
    threadId: string,
  ): Promise<NodeConversationDagGetResult | null>;
  exportDag(ownerId: string, threadId: string): Promise<unknown>;
  deleteDag(ownerId: string, threadId: string): Promise<unknown>;
};
type NodeLexicalProvider = LexicalSearchBackend & {
  exportOwner(
    ownerId: string,
  ): Promise<import("@avermate/agent-contracts").LexicalVersionInput[]>;
  deleteOwner(ownerId: string): Promise<{ deletedVersions: number }>;
  getChunks(
    ownerId: string,
    chunkIds: readonly string[],
  ): Promise<import("@avermate/agent-contracts").StagedContentChunk[]>;
};
type SandboxResolver = (
  ownerId: string,
  providerId: SandboxProviderId,
) => SandboxProvider | null;
type ProviderFetcher = {
  fetch(
    request: NodeProviderFetchRequest,
    signal?: AbortSignal,
  ): Promise<NodeProviderFetchResponse>;
};

function storageAbortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("NODE_STORAGE_OPERATION_ABORTED");
}

function abortableStorageOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  hooks?: {
    onAbort?: () => void;
    onLateResolve?: (value: T) => void;
  },
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    operation.then(
      (value) => hooks?.onLateResolve?.(value),
      () => undefined,
    );
    hooks?.onAbort?.();
    return Promise.reject(storageAbortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(storageAbortReason(signal));
      hooks?.onAbort?.();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        if (settled) {
          hooks?.onLateResolve?.(value);
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Node-side provider dispatcher used behind an authenticated control/data lane.
 * It deliberately contains no Core imports and never substitutes a provider
 * when the requested capability or owner binding is absent.
 */
export class LocalNodeProviderTransport
  implements
    NodeConversationTransport,
    NodeLexicalSearchTransport,
    NodeModelGatewayTransport,
    NodeProviderHttpTransport,
    NodeObjectReadTransport,
    NodeSandboxTransport
{
  #available = true;

  constructor(
    readonly nodeId: string,
    private readonly providers: {
      conversations?: OwnerResolver<ConversationStore>;
      lexical?: OwnerResolver<LexicalSearchBackend>;
      models?: OwnerResolver<ModelGateway>;
      providerHttp?: OwnerResolver<ProviderFetcher>;
      mcp?: LocalNodeMcpTransport;
      storage?: ObjectStorageProvider;
      deletion?: {
        identity: NodeIdentity;
        issuerPublicKeyDer: string;
        expectedIssuerKeyId: string;
      };
      sandboxes?: SandboxResolver;
    },
  ) {}

  setOnline(online: boolean) {
    this.#available = online;
  }

  async online(nodeId: string) {
    return this.#available && nodeId === this.nodeId;
  }

  #assertNode(nodeId: string) {
    if (!this.#available || nodeId !== this.nodeId) {
      throw new Error("NODE_TRANSPORT_UNAVAILABLE");
    }
  }

  #conversations(nodeId: string, ownerId: string) {
    this.#assertNode(nodeId);
    const provider = this.providers.conversations?.(ownerId);
    if (!provider) throw new Error("NODE_CONVERSATIONS_NOT_CONFIGURED");
    return provider;
  }

  #lexical(nodeId: string, ownerId: string) {
    this.#assertNode(nodeId);
    const provider = this.providers.lexical?.(ownerId);
    if (!provider) throw new Error("NODE_RETRIEVAL_NOT_CONFIGURED");
    return provider;
  }

  #models(nodeId: string, ownerId: string) {
    this.#assertNode(nodeId);
    const provider = this.providers.models?.(ownerId);
    if (!provider) throw new Error("NODE_MODELS_NOT_CONFIGURED");
    return provider;
  }

  #providerHttp(nodeId: string, ownerId: string) {
    this.#assertNode(nodeId);
    const provider = this.providers.providerHttp?.(ownerId);
    if (!provider) throw new Error("NODE_PROVIDER_HTTP_NOT_CONFIGURED");
    return provider;
  }

  #mcp(nodeId: string) {
    this.#assertNode(nodeId);
    const provider = this.providers.mcp;
    if (!provider) throw new Error("NODE_MCP_NOT_CONFIGURED");
    return provider;
  }

  inspectNodeMcp(input: {
    nodeId: string;
    ownerId: string;
    request: unknown;
    signal?: AbortSignal;
  }) {
    return this.#mcp(input.nodeId).inspect({
      ownerId: input.ownerId,
      request: input.request,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  invokeNodeMcp(input: {
    nodeId: string;
    ownerId: string;
    request: unknown;
    signal?: AbortSignal;
  }) {
    return this.#mcp(input.nodeId).invoke({
      ownerId: input.ownerId,
      request: input.request,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  #objectStorage(nodeId: string, ownerId: string) {
    this.#assertNode(nodeId);
    const provider = this.providers.storage;
    if (!provider) throw new Error("NODE_STORAGE_NOT_CONFIGURED");
    return { provider, ownerId };
  }

  async executeStorageDeletionManifest(input: {
    nodeId: string;
    ownerId: string;
    manifest: NodeDeletionManifest;
  }): Promise<NodeDeletionReceipt> {
    const { provider } = this.#objectStorage(input.nodeId, input.ownerId);
    const deletion = this.providers.deletion;
    if (!deletion) throw new Error("NODE_STORAGE_DELETION_NOT_CONFIGURED");
    if (input.manifest.userId !== input.ownerId) {
      throw new Error("NODE_OPERATION_OWNER_MISMATCH");
    }
    return executeDeletionManifest({
      manifest: input.manifest,
      issuerPublicKeyDer: deletion.issuerPublicKeyDer,
      expectedIssuerKeyId: deletion.expectedIssuerKeyId,
      identity: deletion.identity,
      storage: provider,
    });
  }

  async statNodeObject(
    input: Parameters<NodeObjectReadTransport["statNodeObject"]>[0],
  ) {
    if (input.signal?.aborted) throw storageAbortReason(input.signal);
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.ref.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return abortableStorageOperation(
      provider.stat({ ref: input.ref }),
      input.signal,
    );
  }

  async storageCapabilities(input: { nodeId: string; ownerId: string }) {
    return this.#objectStorage(
      input.nodeId,
      input.ownerId,
    ).provider.capabilities();
  }

  async getNodeObjectRange(input: {
    nodeId: string;
    ownerId: string;
    range: ObjectStorageRangeInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.range.ref.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return provider.getRange(input.range);
  }

  async putNodeObject(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectStoragePutInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.value.ref.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return provider.put(input.value);
  }

  async deleteNodeObject(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectStorageDeleteInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.value.ref.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return provider.delete(input.value);
  }

  async beginNodeMultipart(input: {
    nodeId: string;
    ownerId: string;
    value: MultipartBeginInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.value.ref.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return provider.beginMultipart(input.value);
  }

  async uploadNodeMultipartPart(input: {
    nodeId: string;
    ownerId: string;
    value: MultipartPartInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.value.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return provider.uploadPart(input.value);
  }

  async completeNodeMultipart(input: {
    nodeId: string;
    ownerId: string;
    value: MultipartCompleteInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.value.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return provider.completeMultipart(input.value);
  }

  async abortNodeMultipart(input: {
    nodeId: string;
    ownerId: string;
    value: MultipartAbortInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.value.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return provider.abortMultipart(input.value);
  }

  async copyNodeObject(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectStorageCopyInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (
      input.value.source.ownerId !== ownerId ||
      input.value.destination.ownerId !== ownerId
    ) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    if (!provider.copy) throw new Error("NODE_STORAGE_COPY_UNSUPPORTED");
    return provider.copy(input.value);
  }

  async *reconcileNodeObjects(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectStorageReconcileInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.value.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    yield* provider.reconcile(input.value);
  }

  async authorizeNodeObjectTransfer(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectTransferGrantInput;
  }) {
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.value.ref.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    return provider.authorizeTransfer(input.value);
  }

  async *readNodeObject(
    input: Parameters<NodeObjectReadTransport["readNodeObject"]>[0],
  ) {
    if (input.signal?.aborted) throw storageAbortReason(input.signal);
    const { provider, ownerId } = this.#objectStorage(
      input.nodeId,
      input.ownerId,
    );
    if (input.ref.ownerId !== ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    const metadata = await abortableStorageOperation(
      provider.stat({ ref: input.ref }),
      input.signal,
    );
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    if (metadata.byteSize > input.maxBytes) {
      throw new Error("OBJECT_READ_LIMIT_EXCEEDED");
    }
    const stream = await abortableStorageOperation(
      provider.get({
        ref: input.ref,
        maxBytes: input.maxBytes,
      }),
      input.signal,
      {
        onLateResolve: (lateStream) => {
          void lateStream.cancel().catch(() => undefined);
        },
      },
    );
    const reader = stream.getReader();
    let readerCancellation: Promise<unknown> | null = null;
    const cancelReader = () => {
      readerCancellation ??= reader.cancel().catch(() => undefined);
      return readerCancellation;
    };
    try {
      while (true) {
        const next = await abortableStorageOperation(
          reader.read(),
          input.signal,
          {
            onAbort: () => {
              void cancelReader();
            },
          },
        );
        if (next.done) return;
        yield next.value;
      }
    } finally {
      const cancellation = cancelReader();
      if (!input.signal?.aborted) await cancellation;
    }
  }

  #sandbox(nodeId: string, ownerId: string, providerId: SandboxProviderId) {
    this.#assertNode(nodeId);
    const provider = this.providers.sandboxes?.(ownerId, providerId);
    if (!provider || provider.id !== providerId) {
      throw new Error("NODE_SANDBOX_NOT_CONFIGURED");
    }
    return provider;
  }

  async appendConversationEvent(
    input: Parameters<NodeConversationTransport["appendConversationEvent"]>[0],
  ) {
    const provider = this.#conversations(input.nodeId, input.ownerId);
    const event = input.event.event;
    const run = await provider.getRun({
      ownerId: input.ownerId,
      threadId: event.threadId,
      branchId: event.branchId,
      runId: event.runId,
    });
    if (!run) throw new Error("NODE_CONVERSATION_OWNER_MISMATCH");
    return provider.appendEvent(input.event);
  }

  provisionConversationRun(
    input: Parameters<
      NonNullable<NodeConversationTransport["provisionConversationRun"]>
    >[0],
  ) {
    const provider = this.#conversationAdministration(
      input.nodeId,
      input.ownerId,
    );
    return provider.provisionRun({
      ownerId: input.ownerId,
      ...input.run,
    });
  }

  replayConversationEvents(
    input: Parameters<NodeConversationTransport["replayConversationEvents"]>[0],
  ) {
    if (input.ownerId !== input.replay.ownerId) {
      throw new Error("NODE_CONVERSATION_OWNER_MISMATCH");
    }
    return this.#conversations(input.nodeId, input.ownerId).replayEvents(
      input.replay,
    );
  }

  getConversationRun(
    input: Parameters<NodeConversationTransport["getConversationRun"]>[0],
  ) {
    if (input.ownerId !== input.run.ownerId) {
      throw new Error("NODE_CONVERSATION_OWNER_MISMATCH");
    }
    return this.#conversations(input.nodeId, input.ownerId).getRun(input.run);
  }

  exportNodeConversations(
    input: Parameters<
      NonNullable<NodeConversationTransport["exportNodeConversations"]>
    >[0],
  ) {
    return this.#conversationAdministration(
      input.nodeId,
      input.ownerId,
    ).exportOwner(input.ownerId);
  }

  deleteNodeConversations(
    input: Parameters<
      NonNullable<NodeConversationTransport["deleteNodeConversations"]>
    >[0],
  ) {
    return this.#conversationAdministration(
      input.nodeId,
      input.ownerId,
    ).deleteOwner(input.ownerId);
  }

  importConversationDag(input: {
    nodeId: string;
    ownerId: string;
    snapshot: NodeConversationDagSnapshot;
  }) {
    if (input.snapshot.ownerId !== input.ownerId) {
      throw new Error("NODE_CONVERSATION_OWNER_MISMATCH");
    }
    return this.#conversationAdministration(
      input.nodeId,
      input.ownerId,
    ).importDag(input.snapshot);
  }

  listConversationDags(input: {
    nodeId: string;
    ownerId: string;
    query: NodeConversationDagListInput;
  }) {
    return this.#conversationAdministration(
      input.nodeId,
      input.ownerId,
    ).listDags(input.ownerId, input.query);
  }

  getConversationDag(input: {
    nodeId: string;
    ownerId: string;
    threadId: string;
  }) {
    return this.#conversationAdministration(input.nodeId, input.ownerId).getDag(
      input.ownerId,
      input.threadId,
    );
  }

  exportConversationDag(input: {
    nodeId: string;
    ownerId: string;
    threadId: string;
  }) {
    return this.#conversationAdministration(
      input.nodeId,
      input.ownerId,
    ).exportDag(input.ownerId, input.threadId);
  }

  deleteConversationDag(input: {
    nodeId: string;
    ownerId: string;
    threadId: string;
  }) {
    return this.#conversationAdministration(
      input.nodeId,
      input.ownerId,
    ).deleteDag(input.ownerId, input.threadId);
  }

  #conversationAdministration(nodeId: string, ownerId: string) {
    const provider = this.#conversations(nodeId, ownerId);
    const candidate = provider as Partial<NodeConversationProvider>;
    if (
      typeof candidate.provisionRun !== "function" ||
      typeof candidate.exportOwner !== "function" ||
      typeof candidate.deleteOwner !== "function" ||
      typeof candidate.importDag !== "function" ||
      typeof candidate.listDags !== "function" ||
      typeof candidate.getDag !== "function" ||
      typeof candidate.exportDag !== "function" ||
      typeof candidate.deleteDag !== "function"
    ) {
      throw new Error("NODE_CONVERSATION_ADMINISTRATION_UNAVAILABLE");
    }
    return candidate as NodeConversationProvider;
  }

  lexicalCapabilities(
    input: Parameters<NodeLexicalSearchTransport["lexicalCapabilities"]>[0],
  ) {
    return this.#lexical(input.nodeId, input.ownerId).capabilities();
  }

  upsertLexicalVersion(
    input: Parameters<NodeLexicalSearchTransport["upsertLexicalVersion"]>[0],
  ) {
    return this.#lexical(input.nodeId, input.ownerId).upsertVersion(
      input.version,
    );
  }

  removeLexicalVersion(
    input: Parameters<NodeLexicalSearchTransport["removeLexicalVersion"]>[0],
  ) {
    return this.#lexical(input.nodeId, input.ownerId).removeVersion(
      input.versionId,
    );
  }

  searchLexical(
    input: Parameters<NodeLexicalSearchTransport["searchLexical"]>[0],
  ) {
    return this.#lexical(input.nodeId, input.ownerId).search(input.query);
  }

  getLexicalChunks(
    input: Parameters<NodeLexicalSearchTransport["getLexicalChunks"]>[0],
  ) {
    return this.#lexicalAdministration(input.nodeId, input.ownerId).getChunks(
      input.ownerId,
      input.chunkIds,
    );
  }

  verifyLexical(
    input: Parameters<NodeLexicalSearchTransport["verifyLexical"]>[0],
  ) {
    return this.#lexical(input.nodeId, input.ownerId).verify();
  }

  exportLexicalOwner(
    input: Parameters<NodeLexicalSearchTransport["exportLexicalOwner"]>[0],
  ) {
    return this.#lexicalAdministration(input.nodeId, input.ownerId).exportOwner(
      input.ownerId,
    );
  }

  deleteLexicalOwner(
    input: Parameters<NodeLexicalSearchTransport["deleteLexicalOwner"]>[0],
  ) {
    return this.#lexicalAdministration(input.nodeId, input.ownerId).deleteOwner(
      input.ownerId,
    );
  }

  #lexicalAdministration(nodeId: string, ownerId: string) {
    const provider = this.#lexical(nodeId, ownerId);
    const candidate = provider as Partial<NodeLexicalProvider>;
    if (
      typeof candidate.exportOwner !== "function" ||
      typeof candidate.deleteOwner !== "function" ||
      typeof candidate.getChunks !== "function"
    ) {
      throw new Error("NODE_LEXICAL_ADMINISTRATION_UNAVAILABLE");
    }
    return candidate as NodeLexicalProvider;
  }

  fetchNodeProvider(
    input: Parameters<NodeProviderHttpTransport["fetchNodeProvider"]>[0],
  ) {
    return this.#providerHttp(input.nodeId, input.ownerId).fetch(
      input.request,
      input.signal,
    );
  }

  listNodeModels(
    input: Parameters<NodeModelGatewayTransport["listNodeModels"]>[0],
  ) {
    return this.#models(input.nodeId, input.context.ownerId).listModels(
      input.context,
    );
  }

  streamNodeModel(
    input: Parameters<NodeModelGatewayTransport["streamNodeModel"]>[0],
  ) {
    return this.#models(input.nodeId, input.request.ownerId).stream(
      input.request,
    );
  }

  embedWithNodeModel(
    input: Parameters<NodeModelGatewayTransport["embedWithNodeModel"]>[0],
  ) {
    return this.#models(input.nodeId, input.request.ownerId).embed(
      input.request,
    );
  }

  transcribeWithNodeModel(
    input: Parameters<NodeModelGatewayTransport["transcribeWithNodeModel"]>[0],
  ) {
    return this.#models(input.nodeId, input.request.ownerId).transcribe(
      input.request,
    );
  }

  estimateNodeModel(
    input: Parameters<NodeModelGatewayTransport["estimateNodeModel"]>[0],
  ) {
    return this.#models(input.nodeId, input.request.ownerId).estimate(
      input.request,
    );
  }

  sandboxCapabilities(
    input: Parameters<NodeSandboxTransport["sandboxCapabilities"]>[0],
  ) {
    return this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    ).capabilities();
  }

  preflightSandbox(
    input: Parameters<NodeSandboxTransport["preflightSandbox"]>[0],
  ) {
    return this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    ).preflight(input.preflight);
  }

  createSandbox(input: Parameters<NodeSandboxTransport["createSandbox"]>[0]) {
    return this.#sandbox(input.nodeId, input.ownerId, input.providerId).create(
      input.create,
    );
  }

  executeSandbox(input: Parameters<NodeSandboxTransport["executeSandbox"]>[0]) {
    return this.#sandbox(input.nodeId, input.ownerId, input.providerId).execute(
      input.execute,
    );
  }

  putSandboxFiles(
    input: Parameters<NodeSandboxTransport["putSandboxFiles"]>[0],
  ) {
    return this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    ).putFiles(input.handle, input.files);
  }

  getSandboxFiles(
    input: Parameters<NodeSandboxTransport["getSandboxFiles"]>[0],
  ) {
    return this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    ).getFiles(input.handle, input.paths);
  }

  readSandboxFile(
    input: Parameters<NodeSandboxTransport["readSandboxFile"]>[0],
  ) {
    return this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    ).readFile(input.handle, input.relativePath);
  }

  snapshotNodeWorkspace(
    input: Parameters<NodeSandboxTransport["snapshotNodeWorkspace"]>[0],
  ) {
    return this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    ).snapshotWorkspace(input.handle);
  }

  forkNodeWorkspace(
    input: Parameters<NodeSandboxTransport["forkNodeWorkspace"]>[0],
  ) {
    return this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    ).forkWorkspace(input.create);
  }

  stopSandbox(input: Parameters<NodeSandboxTransport["stopSandbox"]>[0]) {
    return this.#sandbox(input.nodeId, input.ownerId, input.providerId).stop(
      input.handle,
    );
  }

  destroySandbox(input: Parameters<NodeSandboxTransport["destroySandbox"]>[0]) {
    return this.#sandbox(input.nodeId, input.ownerId, input.providerId).destroy(
      input.handle,
    );
  }

  sandboxRuntimeCheckpointCapabilities(
    input: Parameters<
      NodeSandboxTransport["sandboxRuntimeCheckpointCapabilities"]
    >[0],
  ) {
    const provider = this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    );
    if (!provider.runtimeCheckpointCapabilities) {
      return Promise.resolve({
        available: false as const,
        reason: "provider-unsupported" as const,
      });
    }
    return provider.runtimeCheckpointCapabilities();
  }

  captureSandboxRuntimeCheckpoint(
    input: Parameters<
      NodeSandboxTransport["captureSandboxRuntimeCheckpoint"]
    >[0],
  ) {
    const provider = this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    );
    if (!provider.captureRuntimeCheckpoint) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_UNAVAILABLE");
    }
    return provider.captureRuntimeCheckpoint({
      handle: input.handle,
      sourceWorkspaceSnapshot: input.sourceWorkspaceSnapshot,
      compatibility: input.compatibility,
      idempotencyKey: input.idempotencyKey,
      expiresAt: new Date(input.expiresAt),
    });
  }

  restoreSandboxRuntimeCheckpoint(
    input: Parameters<
      NodeSandboxTransport["restoreSandboxRuntimeCheckpoint"]
    >[0],
  ) {
    const provider = this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    );
    if (!provider.restoreRuntimeCheckpoint) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_UNAVAILABLE");
    }
    return provider.restoreRuntimeCheckpoint({
      create: input.create,
      checkpoint: input.checkpoint,
    });
  }

  async deleteSandboxRuntimeCheckpoint(
    input: Parameters<
      NodeSandboxTransport["deleteSandboxRuntimeCheckpoint"]
    >[0],
  ) {
    const provider = this.#sandbox(
      input.nodeId,
      input.ownerId,
      input.providerId,
    );
    if (!provider.deleteRuntimeCheckpoint) {
      throw new Error("SANDBOX_RUNTIME_CHECKPOINT_UNAVAILABLE");
    }
    await provider.deleteRuntimeCheckpoint(input.checkpoint);
  }
}
