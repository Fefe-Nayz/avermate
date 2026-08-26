import type { ModelUnavailableReason } from "@avermate/agent-contracts"

/**
 * The one thing worth saying at the top of a conversation.
 *
 * The pane used to stack these: an error strip, then an offline alert, then a
 * "no model is ready" alert, each with its own margin, all three able to show
 * at once. On a phone that is the whole screen before a single message — and
 * they mostly repeat each other, because being offline is *why* the send
 * failed. So the pane says one thing, the most fundamental one, and this is
 * where that order lives.
 */
export type PaneNotice =
  | { kind: "deleted" }
  | { kind: "no-model"; reasons: readonly ModelUnavailableReason[] }
  | { kind: "offline" }
  | { kind: "error"; message: string }

export type PaneStatus = {
  notice: PaneNotice | null
  /** Whether a message can be sent right now. */
  canSend: boolean
}

/**
 * Precedence, from the most absolute to the most transient.
 *
 * A deleted conversation refuses everything, so nothing else is worth saying.
 * With no model there is nothing to send to. Offline is temporary but total.
 * An error comes last precisely because the other three explain most errors:
 * telling somebody their message failed *and* that they are offline is telling
 * them the same thing twice, and burying the useful half.
 */
export function paneStatus(input: {
  deleted: boolean
  modelCount: number
  online: boolean
  error: string | null
  unavailable: readonly { unavailableReason?: ModelUnavailableReason | null }[]
}): PaneStatus {
  const canSend = !input.deleted && input.modelCount > 0 && input.online

  if (input.deleted) return { notice: { kind: "deleted" }, canSend }
  if (input.modelCount === 0) {
    return {
      notice: {
        kind: "no-model",
        reasons: [
          ...new Set(
            input.unavailable.flatMap((entry) =>
              entry.unavailableReason ? [entry.unavailableReason] : []
            )
          ),
        ],
      },
      canSend,
    }
  }
  if (!input.online) return { notice: { kind: "offline" }, canSend }
  if (input.error) {
    return { notice: { kind: "error", message: input.error }, canSend }
  }
  return { notice: null, canSend }
}

/**
 * Where to send someone whose models are all unavailable.
 *
 * The reasons are ranked, not counted: a Node that is offline is a different
 * errand from a quota that ran out, and sending a reader to the wrong settings
 * page wastes the trip. Anything unrecognised falls back to providers, which is
 * where a key is added.
 */
export function readinessDestination(
  reasons: readonly ModelUnavailableReason[]
): { href: string; kind: "node" | "managed" | "providers" } {
  const has = (...names: string[]) =>
    reasons.some((reason) => names.includes(reason))

  if (has("node-offline", "node-capability-stale", "sandbox-unavailable")) {
    return { href: "/settings/node", kind: "node" }
  }
  if (has("managed-disabled", "quota-denied")) {
    return { href: "/settings/managed", kind: "managed" }
  }
  return { href: "/settings/integrations", kind: "providers" }
}
