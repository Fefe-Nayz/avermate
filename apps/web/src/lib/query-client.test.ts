import { describe, expect, test } from "bun:test"
import { dehydrate, hydrate } from "@tanstack/react-query"
import {
  getBrowserQueryCacheGeneration,
  getBrowserQueryClient,
  resetBrowserQueryCache,
} from "./browser-query-cache"
import { createQueryClient, isUnauthorized } from "./query-client"

describe("query client", () => {
  test("creates an isolated cache for every request or identity", () => {
    const first = createQueryClient()
    const second = createQueryClient()

    first.setQueryData(["private", "user-a"], { value: 1 })

    expect(second).not.toBe(first)
    expect(second.getQueryData(["private", "user-a"])).toBeUndefined()
  })

  test("round-trips native oRPC values through dehydration", () => {
    const server = createQueryClient()
    const client = createQueryClient()
    const key = ["history", { since: new Date("2025-09-01T00:00:00.000Z") }]

    server.setQueryData(key, {
      generatedAt: new Date("2026-08-11T12:00:00.000Z"),
      total: 42n,
    })
    hydrate(client, dehydrate(server))

    expect(
      client.getQueryData<{ generatedAt: Date; total: bigint }>(key)
    ).toEqual({
      generatedAt: new Date("2026-08-11T12:00:00.000Z"),
      total: 42n,
    })
  })

  test("reuses a fresh hydrated query without an immediate browser fetch", async () => {
    const server = createQueryClient()
    const browser = createQueryClient()
    const key = ["years", "list"]
    let browserRequests = 0

    server.setQueryData(key, [{ id: "year-1" }])
    hydrate(browser, dehydrate(server))

    const data = await browser.fetchQuery({
      queryKey: key,
      queryFn: () => {
        browserRequests += 1
        return Promise.resolve([{ id: "unexpected" }])
      },
    })

    expect(data).toEqual([{ id: "year-1" }])
    expect(browserRequests).toBe(0)
  })

  test("never retries unauthorized operation errors", () => {
    expect(isUnauthorized({ code: "UNAUTHORIZED" })).toBe(true)
    expect(isUnauthorized({ code: "FORBIDDEN" })).toBe(false)
    expect(isUnauthorized(new Error("UNAUTHORIZED"))).toBe(false)
  })

  test("hands the same cache to every render of one document", () => {
    // The point of the singleton: whatever rebuilds the provider tree — a
    // suspended render, Strict Mode's second mount, a keyed remount — gets
    // back the cache the server already filled, not an empty one.
    const first = getBrowserQueryClient("user-a")
    first.setQueryData(["preferences"], { theme: "hydrated" })

    expect(getBrowserQueryClient("user-a")).toBe(first)
    expect(
      getBrowserQueryClient("user-a").getQueryData<{ theme: string }>([
        "preferences",
      ])
    ).toEqual({ theme: "hydrated" })

    resetBrowserQueryCache()
  })

  test("never lets one account read the cache of another", () => {
    const mine = getBrowserQueryClient("user-a")
    mine.setQueryData(["preferences"], { theme: "private-user-theme" })

    const theirs = getBrowserQueryClient("user-b")

    expect(theirs).not.toBe(mine)
    expect(theirs.getQueryData(["preferences"])).toBeUndefined()
    expect(mine.getQueryData(["preferences"])).toBeUndefined()

    resetBrowserQueryCache()
  })

  test("destroys personalized data during an auth reset", () => {
    const client = getBrowserQueryClient("user-a")
    client.setQueryData(["preferences"], { theme: "private-user-theme" })
    const generation = getBrowserQueryCacheGeneration()

    resetBrowserQueryCache()

    expect(client.getQueryData(["preferences"])).toBeUndefined()
    // A fresh instance, so a provider that re-renders after the reset cannot
    // keep writing into the cache the signed-out account was reading.
    expect(getBrowserQueryClient("user-a")).not.toBe(client)
    expect(getBrowserQueryCacheGeneration()).toBeGreaterThan(generation)

    resetBrowserQueryCache()
  })
})
