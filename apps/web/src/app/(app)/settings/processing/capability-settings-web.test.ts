import { describe, expect, test } from "bun:test"

const directory = import.meta.dir

async function source(name: string) {
  return Bun.file(`${directory}/${name}`).text()
}

describe("capability settings web contract", () => {
  test("provides every indexed settings anchor", async () => {
    const content = await source("processing-settings-client.tsx")
    for (const id of [
      "connections",
      "capabilities",
      "policies",
      "usage",
      "privacy",
      "diagnostics",
    ]) {
      expect(content).toContain(`id=\"${id}\"`)
    }
  })

  test("uses manifest fields and write-only secret slots", async () => {
    const content = await source("connection-wizard.tsx")
    const editor = await source("connection-editor.tsx")
    expect(content).toContain("plugin.configurationFields")
    expect(content).toContain("plugin.secretSlots")
    expect(content).toContain('type=\"password\"')
    expect(content).toContain("Secrets are write-only")
    expect(content).toContain('runtimeAvailability !== "ready"')
    expect(content).toContain("adapter unavailable in this build")
    expect(content).not.toContain("providerOptions")
    expect(editor).toContain("Leave blank to keep the current secret")
    expect(editor).toContain("expectedRevision: connection.revision")
    expect(editor).not.toContain("sealedValue")
  })

  test("makes privacy-changing fallback explicit", async () => {
    const content = await source("policy-editor.tsx")
    expect(content).toContain("Privacy boundary changes on fallback")
    expect(content).toContain(
      "If your local server is unavailable, content may be sent to {provider}."
    )
    expect(content).toContain("allowPrivacyEscalationOnFallback")
  })

  test("surfaces immutable routes and safe operation diagnostics", async () => {
    const content = await source("processing-settings-client.tsx")
    expect(content).toContain("data.operation.routePlan?.digest")
    expect(content).toContain("data.attempts.map")
    expect(content).toContain("legacy-to-registry shadow comparison")
    expect(content).not.toContain("sealedValue")
    expect(content).not.toContain("nodeSecretRef")
  })
})
