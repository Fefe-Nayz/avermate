import type {
  AppendConversationEvent,
  CitationResolver,
  ConversationRunRecord,
  ConversationStore,
  CorpusStore,
  GetConversationRun,
  LexicalConsistencyReport,
  LexicalSearchBackend,
  LexicalSearchCapabilities,
  ModelAccessContext,
  ModelDescriptor,
  ModelGateway,
  ModelGatewayEvent,
  ModelRequest,
  OwnedCitationRef,
  OwnedLexicalQuery,
  ReplayConversationEvents,
  SandboxCapabilities,
  SandboxCreateInput,
  SandboxExecuteInput,
  SandboxExecutionEvent,
  SandboxFileManifestEntry,
  SandboxHandle,
  SandboxInputFile,
  SandboxPreflightInput,
  SandboxPreflightResult,
  SandboxProvider,
  SandboxWorkspaceSnapshotRef,
  StoredConversationEvent,
} from "@avermate/agent-contracts";

export class NodeCapabilityUnavailableError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = true) {
    super(code);
    this.name = "NodeCapabilityUnavailableError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Deliberately not a canonical store. Register this adapter until the node's
 * physical DAG/checkpoint implementation passes the plan-029 suite.
 */
export class UnavailableNodeConversationStore implements ConversationStore {
  appendEvent(
    _input: AppendConversationEvent,
  ): Promise<StoredConversationEvent> {
    return Promise.reject(
      new NodeCapabilityUnavailableError(
        "NODE_CONVERSATION_STORE_NOT_CONFORMANT",
      ),
    );
  }

  async *replayEvents(
    _input: ReplayConversationEvents,
  ): AsyncIterable<StoredConversationEvent> {
    throw new NodeCapabilityUnavailableError("PLACEMENT_UNAVAILABLE");
  }

  getRun(_input: GetConversationRun): Promise<ConversationRunRecord | null> {
    return Promise.reject(
      new NodeCapabilityUnavailableError("PLACEMENT_UNAVAILABLE"),
    );
  }
}

/** Vector support alone never upgrades this adapter to available. */
export class UnavailableNodeLexicalSearchBackend implements LexicalSearchBackend {
  async capabilities(): Promise<LexicalSearchCapabilities> {
    return { available: false, implementation: "node-unavailable", modes: [] };
  }

  async upsertVersion(
    _input: Parameters<LexicalSearchBackend["upsertVersion"]>[0],
  ) {
    throw new NodeCapabilityUnavailableError(
      "NODE_LEXICAL_BACKEND_NOT_CONFORMANT",
    );
  }

  async removeVersion(_versionId: string) {
    throw new NodeCapabilityUnavailableError(
      "NODE_LEXICAL_BACKEND_NOT_CONFORMANT",
    );
  }

  async search(_input: OwnedLexicalQuery): Promise<never> {
    throw new NodeCapabilityUnavailableError(
      "NODE_LEXICAL_BACKEND_NOT_CONFORMANT",
    );
  }

  async verify(): Promise<LexicalConsistencyReport> {
    return {
      consistent: false,
      indexedVersions: 0,
      missingVersionIds: [],
      orphanedVersionIds: [],
    };
  }
}

export class UnavailableNodeCitationResolver implements CitationResolver {
  async resolve(_input: OwnedCitationRef): Promise<never> {
    throw new NodeCapabilityUnavailableError(
      "NODE_CITATION_RESOLVER_NOT_CONFORMANT",
    );
  }

  async open(_input: OwnedCitationRef): Promise<never> {
    throw new NodeCapabilityUnavailableError(
      "NODE_CITATION_RESOLVER_NOT_CONFORMANT",
    );
  }
}

export class UnavailableNodeModelGateway implements ModelGateway {
  listModels(_context: ModelAccessContext): Promise<ModelDescriptor[]> {
    return Promise.resolve([]);
  }

  async *stream(_request: ModelRequest): AsyncIterable<ModelGatewayEvent> {
    throw new NodeCapabilityUnavailableError(
      "NODE_MODEL_GATEWAY_NOT_CONFORMANT",
    );
  }

  embed(_request: Parameters<ModelGateway["embed"]>[0]): Promise<never> {
    return Promise.reject(
      new NodeCapabilityUnavailableError("NODE_MODEL_GATEWAY_NOT_CONFORMANT"),
    );
  }

  transcribe(
    _request: Parameters<ModelGateway["transcribe"]>[0],
  ): Promise<never> {
    return Promise.reject(
      new NodeCapabilityUnavailableError("NODE_MODEL_GATEWAY_NOT_CONFORMANT"),
    );
  }

  estimate(_request: ModelRequest): Promise<never> {
    return Promise.reject(
      new NodeCapabilityUnavailableError("NODE_MODEL_GATEWAY_NOT_CONFORMANT"),
    );
  }
}

export class UnavailableNodeSandboxProvider implements SandboxProvider {
  readonly id = "disabled" as const;

  capabilities(): Promise<SandboxCapabilities> {
    return Promise.resolve({
      providerId: this.id,
      available: false,
      profiles: [],
    });
  }

  preflight(_input: SandboxPreflightInput): Promise<SandboxPreflightResult> {
    return Promise.resolve({
      ok: false,
      reason: "PROVIDER_DISABLED",
      message:
        "The paired node has no conformant sandbox provider. No code was executed.",
    });
  }

  create(_input: SandboxCreateInput): Promise<never> {
    return this.#unavailable();
  }

  execute(_input: SandboxExecuteInput): AsyncIterable<SandboxExecutionEvent> {
    return this.#unavailableStream();
  }

  putFiles(
    _handle: SandboxHandle,
    _files: readonly SandboxInputFile[],
  ): Promise<never> {
    return this.#unavailable();
  }

  getFiles(
    _handle: SandboxHandle,
    _paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]> {
    return this.#unavailable();
  }

  readFile(
    _handle: SandboxHandle,
    _relativePath: string,
  ): AsyncIterable<Uint8Array> {
    return this.#unavailableStream();
  }

  snapshotWorkspace(_handle: SandboxHandle): Promise<never> {
    return this.#unavailable();
  }

  forkWorkspace(
    _input: SandboxCreateInput & { source: SandboxWorkspaceSnapshotRef },
  ): Promise<never> {
    return this.#unavailable();
  }

  stop(_handle: SandboxHandle): Promise<never> {
    return this.#unavailable();
  }

  destroy(_handle: SandboxHandle): Promise<never> {
    return this.#unavailable();
  }

  #unavailable<T>(): Promise<T> {
    return Promise.reject(
      new NodeCapabilityUnavailableError(
        "NODE_SANDBOX_PROVIDER_NOT_CONFORMANT",
      ),
    );
  }

  #unavailableStream<T>(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => this.#unavailable<IteratorResult<T>>(),
      }),
    };
  }
}

/** Node corpus placement is one atomic capability, not three toggles. */
export function nodeCorpusPlacementAvailable(input: {
  corpusStore: CorpusStore | null;
  lexical: LexicalSearchBackend;
  citations: CitationResolver | null;
}) {
  return input.lexical
    .capabilities()
    .then((capabilities) =>
      Boolean(input.corpusStore && input.citations && capabilities.available),
    );
}
