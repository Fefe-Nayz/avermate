import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("runtime typography", () => {
  test("runtime font variables bypass Tailwind's theme namespace", async () => {
    const globals = await source("../app/globals.css")

    expect(globals).toContain("font-family: var(--app-font-sans)")
    expect(globals).toContain("font-family: var(--app-font-heading)")
    expect(globals).not.toContain("--font-sans: var(--app-font-sans)")
    expect(globals).not.toContain("--font-heading: var(--app-font-heading)")
  })
})
