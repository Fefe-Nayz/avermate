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

  test("keeps archived years out of the normal active-year fallback", () => {
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
    expect(layout).toContain("HydrateClient")

    expect(providers).not.toContain("useSession")
    expect(providers).toContain("key={`${identity}:${generation}`}")

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
})
