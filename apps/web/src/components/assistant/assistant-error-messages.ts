/**
 * Which failure this is, and whether it has a sentence of its own.
 *
 * Errors arrive with a stable `code` and a prose `message`. The pane used to
 * translate the prose by matching two English strings — neither of which the
 * server ever sent, because all four of its messages were written in French in
 * the server source. So the match never fired and the raw wire text reached
 * the reader: French for an English one, and for the failures that *were* in
 * English, sentences like "Provider outcome was not replay-safe after restart"
 * shown to somebody asking about their homework.
 *
 * Codes are stable and prose is not, so the code is what is matched. This file
 * decides *which* failure it is and returns that; the words live at the call
 * site, because the message extractor only sees `t("…")` where `t` came from
 * `useExtracted()` — a helper handed a `t` is invisible to it and ships
 * untranslated English. See the note in `next.config.ts`.
 */
export const KNOWN_ERROR_CODES = [
  "cancelled",
  "assistant_run_failed",
  "assistant_restart_interrupted",
  "provider_dispatch_unknown",
] as const

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number]

export type ErrorPresentation =
  /** A failure this build knows: the call site has a sentence for it. */
  | { kind: "known"; code: KnownErrorCode }
  /** Anything else: show what the server said, and the code with it. */
  | { kind: "raw"; message: string; code: string | null }
  /** Not even a message. */
  | { kind: "unknown" }

export function errorPresentation(error: {
  code?: string
  message?: string
}): ErrorPresentation {
  if (
    error.code &&
    (KNOWN_ERROR_CODES as readonly string[]).includes(error.code)
  ) {
    return { kind: "known", code: error.code as KnownErrorCode }
  }
  // Better an untranslated sentence than an empty box — and the code goes with
  // it, because an unrecognised failure is exactly the one worth quoting in a
  // bug report. A recognised one already says everything in its sentence.
  if (error.message) {
    return { kind: "raw", message: error.message, code: error.code ?? null }
  }
  return { kind: "unknown" }
}
