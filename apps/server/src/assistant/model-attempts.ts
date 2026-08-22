import type {
  ModelGatewayEvent,
  ModelRequest,
} from "@avermate/agent-contracts";
import { canonicalJson, sha256 } from "../search/values";
import type {
  AssistantGatewaySelection,
  AssistantRunExecutionControl,
} from "./run-service";

export type AssistantModelAttemptEvent = Readonly<{
  event: ModelGatewayEvent;
  selection: AssistantGatewaySelection;
  attempt: number;
}>;

/**
 * Execute the frozen primary route and, only after an explicit retryable
 * pre-output provider error, its ordered frozen fallbacks. A thrown transport
 * error or any error after semantic output has an uncertain outcome and fails
 * closed. Production fallback additionally requires durable attempt claims.
 */
export async function* streamExplicitModelAttempts(input: {
  selection: AssistantGatewaySelection;
  ownerId: string;
  runId: string;
  round: number;
  messages: ModelRequest["messages"];
  tools: ModelRequest["tools"];
  signal: AbortSignal;
  control?: AssistantRunExecutionControl;
  onAttempt?: (
    selection: AssistantGatewaySelection,
    attempt: number,
  ) => void;
}): AsyncGenerator<AssistantModelAttemptEvent> {
  const selections = [
    input.selection,
    ...(input.control ? (input.selection.fallbackSelections ?? []) : []),
  ];
  for (let attempt = 0; attempt < selections.length; attempt += 1) {
    const selection = selections[attempt]!;
    const stableRequestKey = selection.providerSupportsStableRequestKey
      ? `assistant:${input.runId}:model-round:${input.round}:attempt:${attempt}`
      : null;
    const requestDigest = sha256(
      canonicalJson({
        runtime: "avermate-agent-runtime/1",
        runId: input.runId,
        round: input.round,
        attempt,
        providerKey: selection.capability.providerKey,
        providerRevision: selection.providerRevision ?? "legacy/1",
        modelKey: selection.capability.modelKey,
        modelId: selection.descriptor.id,
        modelRevision: selection.modelRevision ?? selection.descriptor.id,
        placement: selection.modelPlacement ?? selection.capability.placement,
        messages: input.messages.map(
          ({ trust, mediaType, content, sourceRef, redactions }) => ({
            trust,
            mediaType,
            content,
            sourceRef,
            redactions,
          }),
        ),
        tools: input.tools,
      }),
    );
    input.onAttempt?.(selection, attempt);
    await input.control?.claimDispatch({
      round: input.round,
      attempt,
      requestDigest,
      stableRequestKey,
      selection,
    });
    await input.control?.transitionDispatch({
      round: input.round,
      attempt,
      state: "dispatching",
    });
    let semanticOutput = false;
    let terminalTransition = false;
    let retryNext = false;
    try {
      for await (const event of selection.gateway.stream({
        ownerId: input.ownerId,
        runId: input.runId,
        ...(stableRequestKey ? { requestKey: stableRequestKey } : {}),
        modelId: selection.descriptor.id,
        messages: input.messages,
        tools: input.tools,
        abortSignal: input.signal,
      })) {
        input.signal.throwIfAborted();
        if (event.type === "error") {
          await input.control?.transitionDispatch({
            round: input.round,
            attempt,
            state: "failed",
            inspectReason: event.code,
          });
          terminalTransition = true;
          if (
            event.retryable &&
            !semanticOutput &&
            attempt + 1 < selections.length
          ) {
            retryNext = true;
            break;
          }
          throw new Error(event.code);
        }
        if (!semanticOutput) {
          await input.control?.transitionDispatch({
            round: input.round,
            attempt,
            state: "acknowledged",
          });
        }
        semanticOutput = true;
        yield { event, selection, attempt };
      }
    } catch (error) {
      if (!terminalTransition) {
        await input.control
          ?.transitionDispatch({
            round: input.round,
            attempt,
            state: input.signal.aborted ? "cancelled" : "failed",
          })
          .catch(() => undefined);
      }
      throw error;
    }
    if (retryNext) continue;
    return;
  }
}
