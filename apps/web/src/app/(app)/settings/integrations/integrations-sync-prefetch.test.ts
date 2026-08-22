import { describe, expect, test } from "bun:test"
import { syncConnectionsInput, syncStatusInput } from "@/lib/route-query-inputs"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("Moodle integration read model", () => {
  test("hydrates the exact year list and every initial connection status", async () => {
    const [page, section] = await Promise.all([
      source("./page.tsx"),
      source("./moodle-sync-section.tsx"),
    ])

    expect(page).not.toContain('"use client"')
    expect(page).toContain("prepareAuthenticatedShell")
    expect(page).toContain("syncConnectionsInput(activeYearId)")
    expect(page).toContain("syncStatusInput(connection.id)")
    expect(page).toContain("connections.map")
    expect(page).toContain("orpc.sync.status.queryOptions")
    expect(page).toContain("HydrateClient")

    expect(section).toContain('"use client"')
    expect(section).toContain("syncConnectionsInput(activeYearId)")
    expect(section).toContain("useYear()")
    expect(section).toContain("syncStatusInput(connection.id)")
    expect(section).toContain("orpc.sync.connections.list.queryOptions")
    expect(syncConnectionsInput("year-8")).toEqual({ yearId: "year-8" })
    expect(syncStatusInput("connection-8")).toEqual({
      connectionId: "connection-8",
    })
  })

  test("keeps refreshes scoped to exact sync queries", async () => {
    const section = await source("./moodle-sync-section.tsx")

    expect(section).toContain("orpc.sync.connections.list.queryKey")
    expect(section).toContain("orpc.sync.status.queryKey")
    expect(section).toContain("exact: true")
    expect(section).not.toContain("orpc.sync.key()")
    expect(section).not.toContain("orpc.snapshot")
    expect(section).toContain("orpc.jobs.get.queryOptions")
  })

  test("preserves BYOK and never reads stored secret material", async () => {
    const [page, client, section] = await Promise.all([
      source("./page.tsx"),
      source("./integrations-client.tsx"),
      source("./moodle-sync-section.tsx"),
    ])

    expect(page).toContain("orpc.serviceKeys.list.queryOptions")
    expect(client).toContain("<ServiceKeysSection />")
    expect(section).not.toContain("connection.sealedCredentials")
    expect(section).not.toContain("connection.caCertPem")
    expect(section).toContain("current.hasCustomCa")
    expect(section).toContain('useState("")')
    expect(section).toContain('autoComplete="off"')
  })

  test("announces live job state and distinguishes an hourly replay", async () => {
    const section = await source("./moodle-sync-section.tsx")

    expect(section).toContain('aria-live="polite"')
    expect(section).toContain("aria-busy={active}")
    expect(section).toContain('role="alert"')
    expect(section).toContain('result.status === "succeeded"')
    expect(section).toContain(
      "This hour's Moodle synchronization is already complete."
    )
  })
})
