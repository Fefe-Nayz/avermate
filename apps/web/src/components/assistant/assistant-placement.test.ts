import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { ModelCapability } from "@avermate/agent-contracts"
import { placementOf } from "./assistant-placement"

const model = (
  placement: ModelCapability["placement"],
  contentLeavesPlacement = false
) =>
  ({
    placement,
    contentLeavesPlacement,
    providerKey: "anthropic",
  }) as ModelCapability

const core = { thread: { placement: { kind: "core" } } }
const node = { thread: { placement: { kind: "node" } } }

/** The file with its comments removed — the rule is about code, not prose. */
function codeOf(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

describe("conversation placement", () => {
  test("binds a project workspace to both thread discovery and creation", () => {
    const client = codeOf("./assistant-client.tsx")

    expect(client).toContain("projectId?: string")
    expect(client).toContain("...(projectId ? { projectId } : {})")
    expect(client).toContain("orpc.assistant.threads.search.queryOptions")
    expect(client).toContain("orpc.assistant.threads.list.queryOptions")
    expect(client).toContain("input: { ...threadListInput, query:")
    expect(client).toContain("input: threadListInput")
    expect(client).toContain("rpc.assistant.threads.create({")
    expect(client).toContain("projectId: projectId ?? null")
  })

  test("a thread pinned to a Node says so whatever model is chosen", () => {
    expect(placementOf(node, model("managed"))).toEqual({ kind: "node" })
    expect(placementOf(node, model("direct-byok"))).toEqual({ kind: "node" })
    expect(placementOf(node, undefined)).toEqual({ kind: "node" })
  })

  test("separates going straight to a provider from going through Avermate", () => {
    expect(placementOf(core, model("direct-byok"))).toEqual({
      kind: "provider-direct",
      provider: "anthropic",
      withAttachedContext: false,
    })
    expect(placementOf(core, model("core"))).toEqual({
      kind: "avermate-via",
      provider: "anthropic",
    })
  })

  test("carries whether the attached context leaves with the message", () => {
    // The one detail a reader deciding what to attach actually needs.
    expect(placementOf(core, model("direct-byok", true))).toMatchObject({
      withAttachedContext: true,
    })
  })

  test("falls back to Avermate when no model is chosen yet", () => {
    expect(placementOf(core, undefined)).toEqual({ kind: "avermate" })
    expect(placementOf(core, model("managed"))).toEqual({ kind: "avermate" })
  })

  test("returns no user-facing words of its own", () => {
    // The extractor only sees `t("…")` where `t` came from `useExtracted()`.
    // A helper handed a `t` ships untranslated English while compiling and
    // reading perfectly — which is how this file was written first.
    const code = codeOf("./assistant-placement.ts")
    expect(code).not.toContain("t(")
    expect(code).not.toMatch(/BYOK|nd_/)
  })
})
