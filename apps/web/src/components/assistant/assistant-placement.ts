import type { ModelCapability } from "@avermate/agent-contracts"

/** Just the part of a thread this needs, so the function stays testable. */
type PlacementSource = {
  thread: { placement: { kind: string } }
}

/**
 * Where a conversation runs, as a fact rather than as a sentence.
 *
 * The header used to read "BYOK · anthropic receives selected context", or in
 * one branch "Custom Node · nd_7fk2q…" — an acronym, a vendor key and a
 * database identifier, shown to somebody asking about their homework. The
 * question a reader is actually asking is *who sees what I type*, and these
 * four cases are the four answers to it.
 *
 * The wording is not here. The message extractor only sees `t("…")` where `t`
 * came from `useExtracted()`, so a helper handed a `t` ships untranslated
 * English while compiling and reading perfectly — see the note in
 * `next.config.ts`. So this returns which case it is, and the header says it.
 */
export type PlacementDescription =
  /** The reader's own machine, whatever model is chosen. */
  | { kind: "node" }
  /** Avermate's own service, end to end. */
  | { kind: "avermate" }
  /** Straight out to a provider the reader configured. */
  | { kind: "provider-direct"; provider: string; withAttachedContext: boolean }
  /** Avermate's service, but a named provider does the answering. */
  | { kind: "avermate-via"; provider: string }

export function placementOf(
  detail: PlacementSource,
  model: ModelCapability | undefined
): PlacementDescription {
  // A thread pinned to a Node stays on that Node whatever model is picked.
  if (detail.thread.placement.kind === "node") return { kind: "node" }
  if (!model || model.placement === "managed") return { kind: "avermate" }
  if (model.placement === "node") return { kind: "node" }
  if (model.placement === "direct-byok") {
    return {
      kind: "provider-direct",
      provider: model.providerKey,
      withAttachedContext: model.contentLeavesPlacement,
    }
  }
  return { kind: "avermate-via", provider: model.providerKey }
}
