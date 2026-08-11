import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const nextConfig = readFileSync(
  new URL("../../next.config.ts", import.meta.url),
  "utf8"
)

describe("canonical onboarding routes", () => {
  test("does not let a legacy dynamic redirect capture the new-year wizard", () => {
    expect(nextConfig).toContain('source: "/onboarding/new"')
    expect(nextConfig).toContain('destination: "/onboarding/new-year"')
    expect(nextConfig).not.toContain('source: "/onboarding/:yearId"')
  })
})
