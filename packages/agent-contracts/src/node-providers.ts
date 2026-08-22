import type {
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
  SandboxWorkspaceSnapshotRef,
} from "./sandbox";

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
  verifyLexical(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<LexicalConsistencyReport>;
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
}
