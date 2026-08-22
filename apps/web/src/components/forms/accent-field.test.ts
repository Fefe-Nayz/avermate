import { describe, expect, test } from "bun:test"

const source = await Bun.file(new URL("./controls.tsx", import.meta.url)).text()

describe("AccentField labels", () => {
  test("extracts every visible and spoken colour name", () => {
    for (const label of [
      "Accent",
      "Green",
      "Teal",
      "Blue",
      "Purple",
      "Amber",
    ]) {
      expect(source).toContain(`t("${label}")`)
    }
    expect(source).toContain('"chart-2": t("Teal")')
    expect(source).toContain('"chart-3": t("Blue")')
    expect(source).toContain('"chart-4": t("Purple")')
    expect(source).toContain('"chart-5": t("Amber")')
    expect(source).not.toContain("label: accent.label,")
  })
})
