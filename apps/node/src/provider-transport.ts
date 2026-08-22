import type {
  ConversationStore,
  LexicalSearchBackend,
  ModelGateway,
  NodeConversationTransport,
  NodeLexicalSearchTransport,
  NodeModelGatewayTransport,
  NodeSandboxTransport,
  SandboxProvider,
  SandboxProviderId,
} from "@avermate/agent-contracts";

type OwnerResolver<T> = (ownerId: string) => T | null;
type SandboxResolver = (
  ownerId: string,
  providerId: SandboxProviderId,
) => SandboxProvider | null;

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
    NodeSandboxTransport
{
  #available = true;

  constructor(
    readonly nodeId: string,
    private readonly providers: {
      conversations?: OwnerResolver<ConversationStore>;
      lexical?: OwnerResolver<LexicalSearchBackend>;
      models?: OwnerResolver<ModelGateway>;
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

  verifyLexical(
    input: Parameters<NodeLexicalSearchTransport["verifyLexical"]>[0],
  ) {
    return this.#lexical(input.nodeId, input.ownerId).verify();
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
}
