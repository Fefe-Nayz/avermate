import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const nextConfig = readFileSync(
  new URL("../../next.config.ts", import.meta.url),
  "utf8"
)

describe("canonical onboarding routes", () => {
  test("keeps the new-year wizard outside the legacy one-segment route", () => {
    expect(nextConfig).toContain('source: "/onboarding/new"')
    expect(nextConfig).toContain('destination: "/onboarding/year/new"')
    expect(nextConfig).not.toContain('source: "/onboarding/:yearId"')
  })
})
