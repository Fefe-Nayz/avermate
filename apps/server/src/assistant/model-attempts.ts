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

export function requestMessageCommitment(
  message: ModelRequest["messages"][number],
) {
  return {
    trust: message.trust,
    mediaType: message.mediaType,
    content: message.content,
    parts:
      message.parts?.map((part) =>
        part.type === "text"
          ? part
          : {
              type: part.type,
              mime: part.mime,
              fallbackText: part.fallbackText,
              evidence: part.evidence,
              // The encrypted handle carries a random nonce. Bind the dispatch
              // to immutable evidence while keeping retry/recovery digests
              // stable for the same exact derivative.
              assetHandle: "opaque-owner-bound-handle",
            },
      ) ?? null,
    sourceRef: message.sourceRef,
    redactions: message.redactions,
  };
}

/**
 * Core-issued asset handles are capabilities for a server-side resolver. They
 * must never cross a gateway boundary that did not explicitly opt into that
 * delivery contract. Keep the cited text part when one exists; for a
 * media-only block, materialise its bounded OCR/text fallback instead.
 */
function messagesForSelection(
  selection: AssistantGatewaySelection,
  messages: ModelRequest["messages"],
): ModelRequest["messages"] {
  if (selection.contextMediaDelivery === "server-resolved") return messages;
  return messages.map((message) => {
    const structured = message.parts;
    if (!structured?.some((part) => part.type !== "text")) return message;
    const textParts = structured.filter((part) => part.type === "text");
    return {
      ...message,
      parts:
        textParts.length > 0
          ? textParts
          : structured.flatMap((part) =>
              part.type === "text"
                ? [part]
                : [
                    {
                      type: "text" as const,
                      text: part.fallbackText,
                      mime: "text/plain",
                      evidence: part.evidence,
                    },
                  ],
            ),
    };
  });
}

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
  onAttempt?: (selection: AssistantGatewaySelection, attempt: number) => void;
}): AsyncGenerator<AssistantModelAttemptEvent> {
  const selections = [
    input.selection,
    ...(input.control ? (input.selection.fallbackSelections ?? []) : []),
  ];
  for (let attempt = 0; attempt < selections.length; attempt += 1) {
    const selection = selections[attempt]!;
    const messages = messagesForSelection(selection, input.messages);
    const tools = selection.descriptor.capabilities.tools ? input.tools : [];
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
        messages: messages.map(requestMessageCommitment),
        tools,
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
        messages,
        tools,
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
