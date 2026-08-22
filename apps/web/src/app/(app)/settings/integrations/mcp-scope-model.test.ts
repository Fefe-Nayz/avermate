import { describe, expect, test } from "bun:test"
import { MCP_SCOPE_GROUPS, MCP_SCOPE_OPTIONS } from "./mcp-scope-model"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

async function serverScopes(): Promise<string[]> {
  const authSource = await source("../../../../../../server/src/lib/auth.ts")
  const declaration = authSource.match(
    /export const MCP_SCOPES = \[([\s\S]*?)\] as const/
  )

  expect(declaration).not.toBeNull()
  return [...(declaration?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    (match) => match[1]
  )
}

describe("OAuth client scope ceiling", () => {
  test("offers every scope accepted by the authorization server", async () => {
    const options: string[] = MCP_SCOPE_OPTIONS.map((option) => option.scope)

    expect(options).toEqual(await serverScopes())
    expect(new Set(options).size).toBe(options.length)
  })

  test("keeps the required base read scope visible and locked", () => {
    const required = MCP_SCOPE_OPTIONS.filter((option) => option.required)

    expect(required).toEqual([{ scope: "avermate:read", required: true }])
    expect(MCP_SCOPE_GROUPS.map((group) => group.id)).toEqual([
      "academic",
      "social",
      "planner",
      "materials",
      "documents",
    ])
  })

  test("shares one complete translated copy across registration and consent", async () => {
    const [acceptedScopes, copySource, registrationSource, consentSource] =
      await Promise.all([
        serverScopes(),
        source("./mcp-scope-copy.ts"),
        source("./integrations-client.tsx"),
        source("../../../auth/consent/consent-client.tsx"),
      ])

    const copiedScopes = [
      ...copySource.matchAll(/^    "(avermate:[^"]+)": \{$/gm),
    ].map((match) => match[1])

    expect(copiedScopes).toEqual(acceptedScopes)
    expect(copySource.match(/^      label: t\(/gm)).toHaveLength(
      acceptedScopes.length
    )
    expect(copySource.match(/^      description: t\(/gm)).toHaveLength(
      acceptedScopes.length
    )

    expect(registrationSource).toContain("const scopeCopy = useMcpScopeCopy()")
    expect(registrationSource).toContain("const info = scopeCopy[option.scope]")
    expect(consentSource).toContain("const mcpScopeCopy = useMcpScopeCopy()")
    expect(consentSource).toContain("...mcpScopeCopy")
    expect(consentSource).toContain(
      "...MCP_SCOPE_OPTIONS.map((option) => option.scope)"
    )

    for (const consumerSource of [registrationSource, consentSource]) {
      expect(
        consumerSource.match(/^    "avermate:[^"]+": \{$/gm) ?? []
      ).toHaveLength(0)
    }
  })
})
