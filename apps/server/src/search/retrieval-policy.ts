import type {
  LexicalCandidate,
  RerankProvider,
  RetrievalFallbackPolicy,
  RetrievalStageTrace,
  SourceLocatorV1,
} from "@avermate/agent-contracts";
import { canonicalJson, estimateTokens, sha256 } from "./values";

export type RetrievalChannel = "lexical" | "dense";

export type PolicyCandidate = LexicalCandidate & {
  channels: readonly RetrievalChannel[];
  fusedScore: number;
  text?: string;
  tokenEstimate?: number;
  headingPath?: readonly string[] | null;
  expandedFromId?: string | null;
};

export type ContextPackingBudget = {
  maximumTokens: number;
  maximumUtf8Bytes: number;
  maximumVisualItems: number;
  maximumEvidenceItems: number;
};

function locatorIdentity(locator: SourceLocatorV1) {
  if (locator.kind === "pdf") return `pdf:${locator.page}`;
  if (locator.kind === "slides") return `slide:${locator.slide}`;
  if (locator.kind === "spreadsheet") {
    return `sheet:${locator.sheet}:${locator.range}`;
  }
  if (locator.kind === "audio" || locator.kind === "video") {
    return `${locator.kind}:${locator.startMs}:${locator.endMs}`;
  }
  return null;
}

export function immutableEvidenceIdentity(candidate: LexicalCandidate) {
  const locator = locatorIdentity(candidate.locator);
  return `${candidate.sourceId}:${candidate.versionId}:${locator ?? candidate.chunkId}`;
}

/** Keep the strongest deterministic representative of each immutable unit. */
export function deduplicateRetrievalCandidates(
  candidates: readonly PolicyCandidate[],
) {
  const selected = new Map<string, PolicyCandidate>();
  for (const candidate of candidates) {
    const key = immutableEvidenceIdentity(candidate);
    const current = selected.get(key);
    if (
      !current ||
      candidate.fusedScore > current.fusedScore ||
      (candidate.fusedScore === current.fusedScore &&
        candidate.chunkId.localeCompare(current.chunkId) < 0)
    ) {
      selected.set(key, candidate);
    }
  }
  return [...selected.values()].sort(
    (left, right) =>
      right.fusedScore - left.fusedScore ||
      left.chunkId.localeCompare(right.chunkId),
  );
}

export function diversifyRetrievalCandidates(
  candidates: readonly PolicyCandidate[],
  options: {
    limit: number;
    maximumPerSource?: number;
    maximumPerLocator?: number;
    /**
     * Explicitly attached sources win the first source-selection rounds while
     * preserving each source's lexical/fused/reranked order. This is a scope
     * priority, not an artificial relevance score.
     */
    prioritySourceIds?: readonly string[];
  },
) {
  const maximumPerSource = options.maximumPerSource ?? 4;
  const maximumPerLocator = options.maximumPerLocator ?? 2;
  const prioritySourceIds = new Set(options.prioritySourceIds ?? []);
  const groups = new Map<string, PolicyCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.sourceId) ?? [];
    group.push(candidate);
    groups.set(candidate.sourceId, group);
  }
  const sourceOrder = [...groups.entries()].sort(
    ([leftId, left], [rightId, right]) =>
      Number(prioritySourceIds.has(rightId)) -
        Number(prioritySourceIds.has(leftId)) ||
      right[0]!.fusedScore - left[0]!.fusedScore ||
      leftId.localeCompare(rightId),
  );
  const sourceCounts = new Map<string, number>();
  const locatorCounts = new Map<string, number>();
  const output: PolicyCandidate[] = [];
  let progress = true;
  while (output.length < options.limit && progress) {
    progress = false;
    for (const [sourceId, group] of sourceOrder) {
      if (output.length >= options.limit) break;
      if ((sourceCounts.get(sourceId) ?? 0) >= maximumPerSource) continue;
      while (group.length > 0) {
        const candidate = group.shift()!;
        const locator = locatorIdentity(candidate.locator);
        const locatorKey = locator
          ? `${candidate.versionId}:${locator}`
          : candidate.chunkId;
        if ((locatorCounts.get(locatorKey) ?? 0) >= maximumPerLocator) {
          continue;
        }
        output.push(candidate);
        sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
        locatorCounts.set(locatorKey, (locatorCounts.get(locatorKey) ?? 0) + 1);
        progress = true;
        break;
      }
    }
  }
  return output;
}

export async function rerankRetrievalCandidates(input: {
  operationId: string;
  query: string;
  candidates: readonly PolicyCandidate[];
  provider: RerankProvider;
  topN: number;
  signal: AbortSignal;
}) {
  const window = input.candidates.slice(
    0,
    Math.min(50, input.provider.descriptor().maximumCandidates),
  );
  const scores = await input.provider.rerank({
    operationId: input.operationId,
    query: input.query,
    candidates: window.map((candidate) => ({
      id: candidate.chunkId,
      text: candidate.text ?? candidate.snippet,
      tokenEstimate:
        candidate.tokenEstimate ??
        estimateTokens(candidate.text ?? candidate.snippet),
    })),
    topN: Math.min(input.topN, window.length),
    signal: input.signal,
  });
  const candidateById = new Map(
    window.map((candidate) => [candidate.chunkId, candidate]),
  );
  const expected = Math.min(input.topN, window.length);
  const scoreIds = new Set(scores.map((score) => score.candidateId));
  if (
    scores.length !== expected ||
    scoreIds.size !== scores.length ||
    scores.some(
      (score, index) =>
        score.operationId !== input.operationId ||
        !candidateById.has(score.candidateId) ||
        score.rank !== index ||
        !Number.isFinite(score.score),
    )
  ) {
    throw new Error("RERANK_RESULT_OUTSIDE_OPERATION");
  }
  return scores.map((score) => ({
    ...candidateById.get(score.candidateId)!,
    score: score.score,
    fusedScore: score.score,
  }));
}

function headingParent(candidate: PolicyCandidate, possible: PolicyCandidate) {
  const child = candidate.headingPath ?? [];
  const parent = possible.headingPath ?? [];
  return (
    child.length > 1 &&
    parent.length === child.length - 1 &&
    parent.every((value, index) => value === child[index]) &&
    possible.ordinal <= candidate.ordinal
  );
}

/** Expand context only after winners are known; expansions never gain rank. */
export function expandParentAndNeighbors(
  winners: readonly PolicyCandidate[],
  authorizedUniverse: readonly PolicyCandidate[],
  options: { neighborRadius?: number; maximumExpandedPerWinner?: number } = {},
) {
  const radius = options.neighborRadius ?? 1;
  const maximum = options.maximumExpandedPerWinner ?? 3;
  const universe = [...authorizedUniverse].sort(
    (left, right) =>
      left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId),
  );
  // Winners are packed first so an expansion can never displace a later,
  // stronger winner when the evidence budget is tight.
  const output: PolicyCandidate[] = winners.map((winner) => ({
    ...winner,
    expandedFromId: null,
  }));
  const expansionsOutput: PolicyCandidate[] = [];
  const used = new Set(winners.map((winner) => winner.chunkId));
  for (const winner of winners) {
    const expansions = universe
      .filter(
        (candidate) =>
          candidate.versionId === winner.versionId &&
          candidate.chunkId !== winner.chunkId &&
          (Math.abs(candidate.ordinal - winner.ordinal) <= radius ||
            headingParent(winner, candidate)),
      )
      .sort((left, right) => {
        const leftDistance = Math.abs(left.ordinal - winner.ordinal);
        const rightDistance = Math.abs(right.ordinal - winner.ordinal);
        return (
          leftDistance - rightDistance ||
          left.chunkId.localeCompare(right.chunkId)
        );
      })
      .slice(0, maximum);
    for (const candidate of expansions) {
      if (used.has(candidate.chunkId)) continue;
      expansionsOutput.push({
        ...candidate,
        fusedScore: winner.fusedScore,
        expandedFromId: winner.chunkId,
      });
      used.add(candidate.chunkId);
    }
  }
  return [...output, ...expansionsOutput];
}

function visual(candidate: PolicyCandidate) {
  return (
    candidate.evidenceKind === "visual-only" ||
    candidate.locator.kind === "pdf" ||
    candidate.locator.kind === "slides" ||
    candidate.locator.kind === "video"
  );
}

export function packRetrievalContext(
  candidates: readonly PolicyCandidate[],
  budget: ContextPackingBudget,
) {
  if (
    !Number.isSafeInteger(budget.maximumTokens) ||
    !Number.isSafeInteger(budget.maximumUtf8Bytes) ||
    !Number.isSafeInteger(budget.maximumVisualItems) ||
    !Number.isSafeInteger(budget.maximumEvidenceItems) ||
    Math.min(...Object.values(budget)) < 0
  ) {
    throw new Error("RETRIEVAL_PACKING_BUDGET_INVALID");
  }
  const encoder = new TextEncoder();
  const packed: PolicyCandidate[] = [];
  const excluded: Array<{ chunkId: string; reason: string }> = [];
  let tokens = 0;
  let bytes = 0;
  let visuals = 0;
  for (const candidate of candidates) {
    const text = candidate.text ?? candidate.snippet;
    const candidateTokens = candidate.tokenEstimate ?? estimateTokens(text);
    const candidateBytes = encoder.encode(text).byteLength;
    const candidateVisuals = visual(candidate) ? 1 : 0;
    let reason: string | null = null;
    if (packed.length >= budget.maximumEvidenceItems) reason = "evidence-count";
    else if (tokens + candidateTokens > budget.maximumTokens)
      reason = "token-budget";
    else if (bytes + candidateBytes > budget.maximumUtf8Bytes)
      reason = "byte-budget";
    else if (visuals + candidateVisuals > budget.maximumVisualItems)
      reason = "visual-budget";
    if (reason) {
      excluded.push({ chunkId: candidate.chunkId, reason });
      continue;
    }
    packed.push(candidate);
    tokens += candidateTokens;
    bytes += candidateBytes;
    visuals += candidateVisuals;
  }
  return {
    packed,
    excluded,
    usage: {
      tokens,
      bytes,
      visualItems: visuals,
      evidenceItems: packed.length,
    },
  };
}

export function retrievalScopeDigest(input: {
  ownerId: string;
  projectIds: readonly string[];
  policyProjectIds?: readonly string[];
  sourceIds?: readonly string[];
  versionIds?: readonly string[];
  contextAccess?: "automatic" | "agent-request" | "explicit-attachment";
  yearIds: readonly string[];
  subjectIds: readonly string[];
  originKinds: readonly string[];
}) {
  return sha256(
    canonicalJson({
      ownerId: input.ownerId,
      projectIds: [...input.projectIds].sort(),
      policyProjectIds: [...(input.policyProjectIds ?? [])].sort(),
      sourceIds: [...(input.sourceIds ?? [])].sort(),
      versionIds: [...(input.versionIds ?? [])].sort(),
      contextAccess: input.contextAccess ?? "agent-request",
      yearIds: [...input.yearIds].sort(),
      subjectIds: [...input.subjectIds].sort(),
      originKinds: [...input.originKinds].sort(),
    }),
  );
}

export function retrievalStage(
  input: RetrievalStageTrace,
): RetrievalStageTrace {
  return input;
}

export function fallbackForFailure(
  policy: RetrievalFallbackPolicy,
  stage: "dense" | "rerank",
) {
  if (policy === "fail")
    throw new Error(`RETRIEVAL_${stage.toUpperCase()}_FAILED`);
  if (stage === "dense") return "lexical-only" as const;
  return policy === "hybrid-without-rerank"
    ? ("hybrid-without-rerank" as const)
    : ("lexical-only" as const);
}
