import {
  assistantRunModelPolicySchema,
  type AssistantModelPreference,
  type AssistantRunModelPolicy,
  type ModelCapability,
  type ModelGateway,
  type ModelGatewayEvent,
  type ModelRequest,
} from "@avermate/agent-contracts";
import type { AssistantSqlClient } from "./core-conversation-store";

export type ModelPolicyDecision = Readonly<{
  selectedModelKey: string;
  policy: AssistantRunModelPolicy;
}>;

function uniqueCapabilities(capabilities: readonly ModelCapability[]) {
  const seen = new Set<string>();
  return capabilities.filter((candidate) => {
    if (seen.has(candidate.modelKey)) return false;
    seen.add(candidate.modelKey);
    return true;
  });
}

/**
 * Freeze one deterministic route. The returned fallback list is explicit and
 * ordered; execution never asks a provider SDK to choose a replacement.
 */
export function decideAssistantModelPolicy(input: {
  preference: AssistantModelPreference;
  requestedModelKey?: string;
  available: readonly ModelCapability[];
  now?: Date;
}): ModelPolicyDecision {
  const available = uniqueCapabilities(input.available);
  if (available.length === 0) throw new Error("MODEL_POLICY_NO_AVAILABLE_ROUTE");
  const requested = input.requestedModelKey ?? null;
  const primaryKey = requested ?? input.preference.defaultModelKey;
  const primary = primaryKey
    ? available.find((candidate) => candidate.modelKey === primaryKey) ?? null
    : null;
  let selected: ModelCapability | null = null;

  if (input.preference.route === "managed-only") {
    const managed = available.filter(
      (candidate) => candidate.placement === "managed",
    );
    if (requested && primary?.placement !== "managed") {
      throw new Error("MODEL_POLICY_MANAGED_PLACEMENT_REQUIRED");
    }
    selected =
      (primary?.placement === "managed" ? primary : null) ?? managed[0] ?? null;
  } else if (input.preference.route === "selected-only") {
    selected = primary;
  } else {
    const preferredPlacement =
      input.preference.route === "prefer-node" ? "node" : "core";
    const preferred = available.filter(
      (candidate) => candidate.placement === preferredPlacement,
    );
    selected =
      (primary?.placement === preferredPlacement ? primary : null) ??
      preferred[0] ??
      primary;
  }

  const rawFallbackPool = (() => {
    if (input.preference.fallback === "none") return [];
    if (input.preference.fallback === "same-provider") {
      const providerKey = primary?.providerKey ?? selected?.providerKey;
      return providerKey
        ? available.filter((candidate) => candidate.providerKey === providerKey)
        : [];
    }
    return available;
  })();
  // Any fallback policy must never silently cross into the operator-paid
  // managed plane. Managed fallbacks are only meaningful when the frozen
  // primary route itself is managed. Direct/Core/Node routes remain isolated
  // from managed spend unless the user explicitly selects managed placement.
  const fallbackPool =
    (selected?.placement ?? primary?.placement) === "managed"
      ? rawFallbackPool
      : rawFallbackPool.filter(
          (candidate) => candidate.placement !== "managed",
        );
  if (!selected && fallbackPool.length > 0) selected = fallbackPool[0] ?? null;
  if (!selected) throw new Error("MODEL_POLICY_PRIMARY_ROUTE_UNAVAILABLE");

  const orderedFallbackModelKeys = fallbackPool
    .filter((candidate) => candidate.modelKey !== selected!.modelKey)
    .map((candidate) => candidate.modelKey);
  return {
    selectedModelKey: selected.modelKey,
    policy: assistantRunModelPolicySchema.parse({
      preferenceRevision: input.preference.revision,
      requestedModelKey: requested,
      selectedModelKey: selected.modelKey,
      route: input.preference.route,
      fallback: input.preference.fallback,
      orderedFallbackModelKeys,
      maximumInputTokens: input.preference.maximumInputTokens,
      maximumOutputTokens: input.preference.maximumOutputTokens,
      maximumEstimatedCostMinor:
        input.preference.maximumEstimatedCostMinor,
      currency: input.preference.currency,
      frozenAt: (input.now ?? new Date()).toISOString(),
    }),
  };
}

function conservativeInputTokenUpperBound(request: ModelRequest) {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const block of request.messages) {
    bytes += encoder.encode(block.content).byteLength + 32;
  }
  for (const tool of request.tools) {
    bytes += encoder.encode(tool.name).byteLength;
    bytes += encoder.encode(tool.description).byteLength;
    bytes += encoder.encode(JSON.stringify(tool.inputSchema) ?? "null").byteLength;
    bytes += 64;
  }
  // Provider tokenizers cannot produce more text tokens than the number of
  // UTF-8 bytes supplied; this intentionally overestimates ordinary prose.
  return bytes;
}

export async function loadAssistantRunModelPolicy(
  client: AssistantSqlClient,
  input: { ownerId: string; runId: string },
) {
  const result = await client.execute({
    sql: `SELECT modelPolicyJson, modelKey FROM assistant_runs
      WHERE id = ? AND userId = ? LIMIT 1`,
    args: [input.runId, input.ownerId],
  });
  const row = result.rows[0];
  if (!row || row.modelPolicyJson === null) return null;
  const policy = assistantRunModelPolicySchema.parse(
    typeof row.modelPolicyJson === "string"
      ? JSON.parse(row.modelPolicyJson)
      : row.modelPolicyJson,
  );
  if (String(row.modelKey) !== policy.selectedModelKey) {
    throw new Error("MODEL_POLICY_SELECTION_CHANGED");
  }
  return policy;
}

async function frozenPolicy(
  client: AssistantSqlClient,
  request: ModelRequest,
  attemptedModelKey: string,
) {
  const policy = await loadAssistantRunModelPolicy(client, {
    ownerId: request.ownerId,
    runId: request.runId,
  });
  if (!policy) return null;
  if (
    policy.selectedModelKey !== attemptedModelKey &&
    !policy.orderedFallbackModelKeys.includes(attemptedModelKey)
  ) {
    throw new Error("MODEL_POLICY_ROUTE_NOT_FROZEN");
  }
  return policy;
}

/** Exact gateway decorator used for a primary or explicitly frozen fallback. */
export class PolicyConstrainedModelGateway implements ModelGateway {
  constructor(
    private readonly delegate: ModelGateway,
    private readonly client: AssistantSqlClient,
    private readonly attemptedModelKey: string,
  ) {}

  listModels(context: Parameters<ModelGateway["listModels"]>[0]) {
    return this.delegate.listModels(context);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelGatewayEvent> {
    const policy = await frozenPolicy(
      this.client,
      request,
      this.attemptedModelKey,
    );
    if (!policy) {
      yield* this.delegate.stream(request);
      return;
    }
    const inputUpperBound = conservativeInputTokenUpperBound(request);
    if (
      policy.maximumInputTokens !== null &&
      inputUpperBound > policy.maximumInputTokens
    ) {
      throw new Error("MODEL_POLICY_INPUT_TOKEN_LIMIT_EXCEEDED");
    }
    const constrainedRequest = {
      ...request,
      ...(policy.maximumOutputTokens
        ? { maximumOutputTokens: policy.maximumOutputTokens }
        : {}),
    };
    if (policy.maximumEstimatedCostMinor !== null) {
      const estimate = await this.delegate.estimate(constrainedRequest);
      if (
        estimate.estimatedCostMinor === "unknown" ||
        estimate.currency === "unknown"
      ) {
        throw new Error("MODEL_POLICY_COST_ESTIMATE_UNAVAILABLE");
      }
      if (
        !policy.currency ||
        estimate.currency.toUpperCase() !== policy.currency.toUpperCase()
      ) {
        throw new Error("MODEL_POLICY_COST_CURRENCY_MISMATCH");
      }
      if (estimate.estimatedCostMinor > policy.maximumEstimatedCostMinor) {
        throw new Error("MODEL_POLICY_ESTIMATED_COST_LIMIT_EXCEEDED");
      }
    }
    for await (const event of this.delegate.stream(constrainedRequest)) {
      if (
        event.type === "usage" &&
        policy.maximumOutputTokens !== null &&
        event.usage.outputTokens !== "unknown" &&
        event.usage.outputTokens > policy.maximumOutputTokens
      ) {
        throw new Error("MODEL_POLICY_OUTPUT_TOKEN_LIMIT_EXCEEDED");
      }
      yield event;
    }
  }

  embed(request: Parameters<ModelGateway["embed"]>[0]) {
    return this.delegate.embed(request);
  }

  transcribe(request: Parameters<ModelGateway["transcribe"]>[0]) {
    return this.delegate.transcribe(request);
  }

  estimate(request: Parameters<ModelGateway["estimate"]>[0]) {
    return this.delegate.estimate(request);
  }
}
