import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("route breadcrumb hydration", () => {
  test("keeps query-backed labels generic through the first browser render", async () => {
    const breadcrumb = await source("./use-breadcrumbs.ts")

    expect(breadcrumb).toContain("useSyncExternalStore(")
    expect(breadcrumb).toContain("const getHydratedSnapshot = () => true")
    expect(breadcrumb).toContain(
      "const getServerHydrationSnapshot = () => false"
    )

    // This value comes from a page-level hydration boundary. The shell must
    // not consume an already-warm browser cache until its server DOM has been
    // hydrated, otherwise generic server text can disagree with a real title.
    expect(breadcrumb).toContain(
      "const projectTitle = canUseProjectQueryLabel\n    ?"
    )
  })
})
