import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("mobile header scroll geometry", () => {
  test("keeps the large title in the scroll flow", async () => {
    const shell = await source("./app-shell.tsx")
    const header = await source("./mobile-header.tsx")

    expect(header).toContain("export function MobilePageTitle")
    expect(header).not.toContain("max-h-0")
    expect(header).not.toContain("max-h-24")

    const scrollPane = shell.indexOf("ref={scrollRef}")
    const largeTitle = shell.indexOf("<MobilePageTitle />")
    const pageContent = shell.indexOf("{children}", largeTitle)

    expect(scrollPane).toBeGreaterThan(-1)
    expect(largeTitle).toBeGreaterThan(scrollPane)
    expect(pageContent).toBeGreaterThan(largeTitle)
  })
})
