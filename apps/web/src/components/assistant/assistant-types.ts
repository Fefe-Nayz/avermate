import type {
  AgentApprovalMode,
  AssistantAttachmentKind,
  AssistantBranch,
  AssistantCitation,
  AssistantContextManifest,
  AssistantMessage,
  AssistantRun,
  AssistantThread,
  AssistantThreadDetail as AssistantThreadDetailDto,
  HistoricalBranchChoice,
  HistoricalBranchOperation,
  HistoricalBranchPreview,
  ModelCapability,
  ModelReadiness,
} from "@avermate/agent-contracts"
import type {
  AssistantCanonicalSnapshot,
  AssistantEditIntent,
  AssistantTurnIntent,
} from "./assistant-runtime-adapter"

export interface AssistantThreadSummary extends AssistantThread {
  preview?: string | null
  lastMessageAt?: string | null
  running?: boolean
}

export interface AssistantSkillOption {
  id: string
  label: string
  description?: string | null
  enabled: boolean
}

export interface AssistantProjectOption {
  id: string
  title: string
  emoji?: string | null
}

export interface AssistantPendingReference {
  clientId: string
  kind: AssistantAttachmentKind
  referenceId: string
  snapshotVersion?: string | null
  label: string
  mimeType?: string | null
}

export interface AssistantReferenceOption extends AssistantPendingReference {
  description?: string | null
  searchText?: string
}

export interface AssistantCitationTarget {
  citationId: string
  title: string
  subtitle?: string | null
  excerpt?: string | null
  href?: string | null
  locatorLabel?: string | null
  mimeType?: string | null
}

export interface AssistantThreadDetail extends AssistantCanonicalSnapshot {
  activeBranchId: string | null
  citations: readonly AssistantCitation[]
  manifests: readonly AssistantContextManifest[]
  usage: readonly {
    runId: string
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    cachedReadTokens: number | null
    cachedWriteTokens: number | null
    estimatedCost: string | null
    currency: string | null
  }[]
  activeRunProjections: AssistantThreadDetailDto["activeRunProjections"]
}

export interface AssistantExportResult {
  fileName: string
  mimeType: string
  content: string
  digest: string
}

export interface AssistantWorkspaceState {
  threads: readonly AssistantThreadSummary[]
  detail: AssistantThreadDetail | null
  models: readonly ModelCapability[]
  modelReadiness: readonly ModelReadiness[]
  skills: readonly AssistantSkillOption[]
  projects: readonly AssistantProjectOption[]
  referenceOptions: readonly AssistantReferenceOption[]
  selectedModelKey: string
  selectedSkillId: string | null
  planMode: boolean
  approvalMode: AgentApprovalMode
  searchQuery: string
  loadingThreads: boolean
  loadingDetail: boolean
  error: string | null
}

export interface AssistantWorkspaceActions {
  createThread: () => Promise<string>
  selectThread: (threadId: string) => void
  searchThreads: (query: string) => void
  updateThread: (
    threadId: string,
    patch: {
      title?: string
      starred?: boolean
      archived?: boolean
    }
  ) => Promise<void>
  trashThread: (threadId: string) => Promise<void>
  restoreThread: (threadId: string) => Promise<void>
  send: (
    intent: AssistantTurnIntent & {
      modelKey: string
      skillId: string | null
      planMode: boolean
      references: readonly AssistantPendingReference[]
    }
  ) => Promise<void>
  edit: (
    intent: AssistantEditIntent & {
      modelKey: string
      skillId: string | null
      planMode: boolean
      references: readonly AssistantPendingReference[]
      historicalBranch: HistoricalBranchChoice
    }
  ) => Promise<void>
  retry: (input: {
    messageId: string
    modelKey: string
    skillId: string | null
    planMode: boolean
    historicalBranch: HistoricalBranchChoice
  }) => Promise<void>
  previewHistoricalBranch: (input: {
    messageId: string
    sourceBranchId: string
    operation: HistoricalBranchOperation
  }) => Promise<HistoricalBranchPreview>
  cancel: (runId: string) => Promise<void>
  answerQuestion: (
    runId: string,
    questionId: string,
    answer: string
  ) => Promise<void>
  switchBranch: (branch: AssistantBranch) => void
  refetch: () => Promise<void>
  setModel: (modelKey: string) => void
  setSkill: (skillId: string | null) => void
  setPlanMode: (enabled: boolean) => void
  setApprovalMode: (mode: AgentApprovalMode) => void
  uploadAttachment: (file: File) => Promise<AssistantPendingReference>
  transcribeDictation: (file: File) => Promise<string>
  openCitation: (citationId: string) => Promise<AssistantCitationTarget>
  openArtifact: (artifactId: string, revisionId?: string) => void
  exportThread: (
    threadId: string,
    format: "json" | "markdown",
    mode: "active-branch" | "whole-dag"
  ) => Promise<AssistantExportResult>
  saveToProject: (
    threadId: string,
    projectId: string,
    mode: "reference" | "markdown"
  ) => Promise<void>
}

export type { AssistantMessage, AssistantRun, AssistantThread, ModelCapability }
