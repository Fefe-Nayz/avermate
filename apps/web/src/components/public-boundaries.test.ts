import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("public route boundaries", () => {
  test("the root provider has no authenticated reads or query cache", async () => {
    const providers = await source("./providers.tsx")

    expect(providers).not.toContain("useSession")
    expect(providers).not.toContain("AppearanceSync")
    expect(providers).not.toContain("QueryClientProvider")
    expect(providers).not.toContain("SESSION_LOST_EVENT")
  })

  test("landing statistics stay a server-only read", async () => {
    const stats = await source("./landing/landing-stats.tsx")

    expect(stats).not.toContain('"use client"')
    expect(stats).not.toContain("useQuery")
    expect(stats).toContain("getPublicStats")
  })
})
