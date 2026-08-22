import { describe, expect, test } from "bun:test"
import { resolveActiveYearId } from "./year-selection"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

const years = [
  {
    id: "older",
    startsAt: new Date("2024-09-01T00:00:00.000Z"),
    endsAt: new Date("2025-07-15T23:59:59.000Z"),
  },
  {
    id: "current",
    startsAt: new Date("2025-09-01T00:00:00.000Z"),
    endsAt: new Date("2026-07-15T23:59:59.000Z"),
  },
]

describe("authenticated shell data", () => {
  test("resolves a valid semantic year choice before the date fallback", () => {
    expect(
      resolveActiveYearId(
        years,
        "older",
        new Date("2026-02-01T00:00:00.000Z").getTime()
      )
    ).toBe("older")
  })

  test("falls back to the year containing today, including boundaries", () => {
    expect(
      resolveActiveYearId(
        years,
        "missing",
        new Date("2025-09-01T00:00:00.000Z").getTime()
      )
    ).toBe("current")
    expect(resolveActiveYearId([], null)).toBeNull()
  })

  test("keeps archived years out of fallback while honoring an explicit deep link", () => {
    const archivedCurrent = years.map((year) =>
      year.id === "current"
        ? { ...year, archivedAt: new Date("2026-08-01T00:00:00.000Z") }
        : year
    )

    expect(
      resolveActiveYearId(
        archivedCurrent,
        "current",
        new Date("2026-02-01T00:00:00.000Z").getTime()
      )
    ).toBe("current")
    expect(
      resolveActiveYearId(
        archivedCurrent,
        null,
        new Date("2026-02-01T00:00:00.000Z").getTime()
      )
    ).toBe("older")
    expect(
      resolveActiveYearId(
        [archivedCurrent[1]!],
        "current",
        new Date("2026-02-01T00:00:00.000Z").getTime()
      )
    ).toBe("current")
  })

  test("the app layout is server-owned and hydrates every common query", async () => {
    const [layout, providers, data, profile] = await Promise.all([
      source("../app/(app)/layout.tsx"),
      source("../components/authenticated-providers.tsx"),
      source("./authenticated-data.ts"),
      source("../../../server/src/routers/profile.ts"),
    ])

    expect(layout).not.toContain('"use client"')
    expect(layout).not.toContain("useSession")
    expect(layout).toContain("prepareAuthenticatedShell")
    expect(layout).toContain("dehydratedState={dehydrate(queryClient)}")

    expect(providers).not.toContain("useSession")
    expect(providers).toContain("key={`${identity}:${generation}`}")

    // The hydration has to be the outermost thing inside the cache scope. Any
    // reader rendered before it — `AppearanceSync` was one — creates the query
    // itself, and the server's answer then arrives an effect late. See the
    // comment on `AuthenticatedProviders`.
    const tree = providers.slice(
      providers.indexOf("export function AuthenticatedProviders")
    )
    const boundary = tree.indexOf("<HydrationBoundary")
    expect(boundary).toBeGreaterThan(-1)
    for (const reader of [
      "<AppearanceSync",
      "<MokattamCelebration",
      "{children}",
    ]) {
      expect(tree.indexOf(reader)).toBeGreaterThan(boundary)
    }

    expect(data).toContain("Promise.all")
    for (const query of [
      "years.list",
      "preferences.get",
      "announcements.active",
      "admin.access",
      "snapshot.get",
    ]) {
      expect(data).toContain(query)
    }
    expect(profile).toContain("viewer: protectedProcedure")
    expect(profile).not.toContain("context.session.session")
  })

  /**
   * The server prepares that cache on every request, so the two ways of
   * throwing it away are worth naming in a test rather than rediscovering.
   *
   * Holding it in component state, or emptying it from an effect cleanup,
   * looked local and safe and was neither: hydration happens during render, so
   * a render React discards — or a second Strict Mode mount — loses data that
   * nothing puts back. Asking the browser for a whole new document does the
   * same thing on purpose, and the language setting was doing it for a change
   * a server render alone carries.
   */
  test("a page load and a language change both keep the prepared cache", async () => {
    const [providers, appearance] = await Promise.all([
      source("../components/authenticated-providers.tsx"),
      source("../components/theme/appearance-sync.tsx"),
    ])

    const code = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n")

    // TanStack's App Router guidance: one cache per document, reached through
    // a module, never created by `useState` and never cleared on unmount.
    expect(code(providers)).toContain("getBrowserQueryClient(identity)")
    expect(code(providers)).not.toContain("useState(createQueryClient)")
    expect(code(providers)).not.toContain("queryClient.clear()")

    expect(code(appearance)).not.toContain("window.location.reload()")
    expect(appearance).toContain("router.refresh()")
    // The refresh re-reads the account on the server, so it has to follow the
    // write rather than the optimistic value it would otherwise overtake.
    expect(appearance).toContain("if (isLoading || isSaving) return")
  })
})
