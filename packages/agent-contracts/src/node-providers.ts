import type {
  ConversationPlacement,
  AppendConversationEvent,
  ConversationRunRecord,
  GetConversationRun,
  ReplayConversationEvents,
} from "./conversation-store";
import type {
  LexicalCandidate,
  LexicalConsistencyReport,
  LexicalSearchCapabilities,
  LexicalVersionInput,
  OwnedLexicalQuery,
  StagedContentChunk,
} from "./corpus";
import type { StoredConversationEvent } from "./events";
import type {
  EmbedRequest,
  EmbedResult,
  ModelAccessContext,
  ModelDescriptor,
  ModelGatewayEvent,
  ModelRequest,
  TranscriptionRequest,
  TranscriptionResult,
  UsageEstimate,
} from "./model-gateway";
import type {
  SandboxCapabilities,
  SandboxCreateInput,
  SandboxExecuteInput,
  SandboxExecutionEvent,
  SandboxFileManifestEntry,
  SandboxHandle,
  SandboxInputFile,
  SandboxPreflightInput,
  SandboxPreflightResult,
  SandboxProviderId,
  SandboxRuntimeCheckpointCapabilities,
  SandboxRuntimeCheckpointCompatibilityV1,
  SandboxRuntimeCheckpointRefV1,
  SandboxWorkspaceSnapshotRef,
} from "./sandbox";
import type { ObjectStorageMetadata, OwnedObjectRef } from "./storage";
import type { NodeWireBytes } from "./node-operations";

export type NodeProviderFetchPurpose = "embedding" | "rerank";

/**
 * A deliberately tiny HTTP envelope for Node-private inference services.
 * The Node validates the URL against its own configured endpoint, strips all
 * Core credentials and injects only its local secret reference.
 */
export type NodeProviderFetchRequest = {
  purpose: NodeProviderFetchPurpose;
  url: string;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: NodeWireBytes;
};

export type NodeProviderFetchResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: NodeWireBytes;
};

/**
 * Authenticated Core-to-Node transports for the provider contracts.
 *
 * Implementations are responsible for the plan-032 wire concerns (short-lived
 * capability grants, bounded frames/bodies, cancellation and node identity).
 * Keeping those concerns below the provider adapters prevents domain services
 * from learning whether a provider is in-process, relayed or on a paired node.
 */
export interface NodeTransportAvailability {
  online(nodeId: string): Promise<boolean>;
}

export interface NodeConversationTransport extends NodeTransportAvailability {
  provisionConversationRun?(input: {
    nodeId: string;
    ownerId: string;
    run: {
      threadId: string;
      branchId: string;
      runId: string;
      placement: ConversationPlacement;
    };
  }): Promise<ConversationRunRecord>;
  appendConversationEvent(input: {
    nodeId: string;
    ownerId: string;
    event: AppendConversationEvent;
  }): Promise<StoredConversationEvent>;
  replayConversationEvents(input: {
    nodeId: string;
    ownerId: string;
    replay: ReplayConversationEvents;
  }): AsyncIterable<StoredConversationEvent>;
  getConversationRun(input: {
    nodeId: string;
    ownerId: string;
    run: GetConversationRun;
  }): Promise<ConversationRunRecord | null>;
  exportNodeConversations?(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<unknown>;
  deleteNodeConversations?(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<{ deletedRuns: number; deletedEvents: number }>;
}

/** A node lexical adapter is owner-bound because remove/verify lack owner IDs. */
export interface NodeLexicalSearchTransport extends NodeTransportAvailability {
  lexicalCapabilities(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<LexicalSearchCapabilities>;
  upsertLexicalVersion(input: {
    nodeId: string;
    ownerId: string;
    version: LexicalVersionInput;
  }): Promise<void>;
  removeLexicalVersion(input: {
    nodeId: string;
    ownerId: string;
    versionId: string;
  }): Promise<void>;
  searchLexical(input: {
    nodeId: string;
    ownerId: string;
    query: OwnedLexicalQuery;
  }): Promise<LexicalCandidate[]>;
  getLexicalChunks(input: {
    nodeId: string;
    ownerId: string;
    chunkIds: string[];
  }): Promise<StagedContentChunk[]>;
  verifyLexical(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<LexicalConsistencyReport>;
  exportLexicalOwner(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<LexicalVersionInput[]>;
  deleteLexicalOwner(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<{ deletedVersions: number }>;
}

export interface NodeProviderHttpTransport extends NodeTransportAvailability {
  fetchNodeProvider(input: {
    nodeId: string;
    ownerId: string;
    request: NodeProviderFetchRequest;
    signal?: AbortSignal;
  }): Promise<NodeProviderFetchResponse>;
}

/**
 * Read-only, owner-bound object lane used to adopt a reviewed Node result into
 * Core. Mutating storage operations remain on the dedicated storage protocol.
 */
export interface NodeObjectReadTransport extends NodeTransportAvailability {
  statNodeObject(input: {
    nodeId: string;
    ownerId: string;
    ref: OwnedObjectRef;
    signal?: AbortSignal;
  }): Promise<ObjectStorageMetadata | null>;
  readNodeObject(input: {
    nodeId: string;
    ownerId: string;
    ref: OwnedObjectRef;
    maxBytes: number;
    signal?: AbortSignal;
  }): AsyncIterable<Uint8Array>;
}

export interface NodeModelGatewayTransport extends NodeTransportAvailability {
  listNodeModels(input: {
    nodeId: string;
    context: ModelAccessContext;
  }): Promise<ModelDescriptor[]>;
  streamNodeModel(input: {
    nodeId: string;
    request: ModelRequest;
  }): AsyncIterable<ModelGatewayEvent>;
  embedWithNodeModel(input: {
    nodeId: string;
    request: EmbedRequest;
  }): Promise<EmbedResult>;
  transcribeWithNodeModel(input: {
    nodeId: string;
    request: TranscriptionRequest;
  }): Promise<TranscriptionResult>;
  estimateNodeModel(input: {
    nodeId: string;
    request: ModelRequest;
  }): Promise<UsageEstimate>;
}

export interface NodeSandboxTransport extends NodeTransportAvailability {
  sandboxCapabilities(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
  }): Promise<SandboxCapabilities>;
  preflightSandbox(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    preflight: SandboxPreflightInput;
  }): Promise<SandboxPreflightResult>;
  createSandbox(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    create: SandboxCreateInput;
  }): Promise<SandboxHandle>;
  executeSandbox(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    execute: SandboxExecuteInput;
  }): AsyncIterable<SandboxExecutionEvent>;
  putSandboxFiles(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    handle: SandboxHandle;
    files: readonly SandboxInputFile[];
  }): Promise<void>;
  getSandboxFiles(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    handle: SandboxHandle;
    paths: readonly string[];
  }): Promise<readonly SandboxFileManifestEntry[]>;
  readSandboxFile(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    handle: SandboxHandle;
    relativePath: string;
  }): AsyncIterable<Uint8Array>;
  snapshotNodeWorkspace(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    handle: SandboxHandle;
  }): Promise<SandboxWorkspaceSnapshotRef>;
  forkNodeWorkspace(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    create: SandboxCreateInput & { source: SandboxWorkspaceSnapshotRef };
  }): Promise<SandboxHandle>;
  stopSandbox(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    handle: SandboxHandle;
  }): Promise<void>;
  destroySandbox(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    handle: SandboxHandle;
  }): Promise<void>;
  sandboxRuntimeCheckpointCapabilities(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
  }): Promise<SandboxRuntimeCheckpointCapabilities>;
  captureSandboxRuntimeCheckpoint(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    handle: SandboxHandle;
    sourceWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    compatibility: SandboxRuntimeCheckpointCompatibilityV1;
    idempotencyKey: string;
    expiresAt: string;
  }): Promise<SandboxRuntimeCheckpointRefV1>;
  restoreSandboxRuntimeCheckpoint(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    create: SandboxCreateInput;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }): Promise<SandboxHandle>;
  deleteSandboxRuntimeCheckpoint(input: {
    nodeId: string;
    ownerId: string;
    providerId: SandboxProviderId;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }): Promise<void>;
}
