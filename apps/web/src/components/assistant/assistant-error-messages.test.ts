import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  errorPresentation,
  KNOWN_ERROR_CODES,
} from "./assistant-error-messages"

/** The file with its comments removed — the rule is about code, not prose. */
function codeOf(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

describe("assistant error presentation", () => {
  test("decides on the code, never on the prose", () => {
    // The whole point: the wire prose used to be French while the client
    // matched English, so nothing ever matched and raw text reached readers.
    expect(
      errorPresentation({
        code: "cancelled",
        message: "Réponse interrompue par l’utilisateur.",
      })
    ).toEqual({ kind: "known", code: "cancelled" })
  })

  test("recognises every code the system emits", () => {
    for (const code of KNOWN_ERROR_CODES) {
      expect(errorPresentation({ code, message: "raw wire text" })).toEqual({
        kind: "known",
        code,
      })
    }
  })

  test("keeps the message for a code this build has not met, and the code with it", () => {
    // An unrecognised failure is the one worth quoting in a bug report.
    expect(
      errorPresentation({ code: "some_future_code", message: "Disk is full" })
    ).toEqual({
      kind: "raw",
      message: "Disk is full",
      code: "some_future_code",
    })
  })

  test("copes with a message and no code, and with neither", () => {
    expect(errorPresentation({ message: "Disk is full" })).toEqual({
      kind: "raw",
      message: "Disk is full",
      code: null,
    })
    expect(errorPresentation({})).toEqual({ kind: "unknown" })
  })

  test("returns no user-facing words of its own", () => {
    // Words live at the call site, because the extractor only sees `t("…")`
    // where `t` came from `useExtracted()`. A helper handed a `t` silently
    // ships untranslated English — which is how this file was written first.
    expect(codeOf("./assistant-error-messages.ts")).not.toContain("t(")
  })
})
