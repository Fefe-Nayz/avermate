import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const srcDirectory = fileURLToPath(new URL("..", import.meta.url))

function readSource(relativePath: string): string {
  return readFileSync(join(srcDirectory, relativePath), "utf8")
}

function sourceFiles(relativeDirectory: string): string[] {
  const directory = join(srcDirectory, relativeDirectory)
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(relativeDirectory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : []
  })
}

describe("fluid sizing boundaries", () => {
  test("keeps the converted expressive ladders fluid", () => {
    const landing = readSource("app/page.tsx")
    const landingChrome = readSource("components/landing/landing-chrome.tsx")
    const landingStats = readSource(
      "components/landing/landing-stats-strip.tsx"
    )
    const yearReview = readSource("components/review/year-review-story.tsx")

    expect(landing).toContain("clamp-[pt,14,20]")
    expect(landing).toContain("clamp-[py,20,28]")
    expect(landing).toContain("clamp-[py,16,20]")
    expect(landingChrome).toContain("clamp-[text,3xl,4xl]")
    expect(landingStats).toContain("clamp-[text,2xl,4xl]")
    expect(landingStats).toContain("clamp-[py,8,10]")
    expect(yearReview).toContain("clamp-[text,base,xl]")

    expect(landing).not.toMatch(/\b(?:pt-14.*sm:pt-20|py-20.*lg:py-28)\b/)
    expect(landingChrome).not.toContain("sm:text-4xl")
    expect(landingStats).not.toMatch(/\b(?:sm:text-4xl|lg:py-10)\b/)
    expect(yearReview).not.toContain("sm:text-xl")
  })

  test("leaves fixed auth and onboarding title endpoints unchanged", () => {
    const authFiles = [
      "app/auth/forgot-password/page.tsx",
      "app/auth/reset-password/page.tsx",
      "app/auth/sign-in/page.tsx",
      "app/auth/sign-up/page.tsx",
      "app/auth/verify/page.tsx",
    ]

    for (const file of authFiles) {
      const source = readSource(file)
      expect(source).toContain("text-3xl font-semibold tracking-tight")
      expect(source).not.toContain("clamp-[")
    }

    for (const file of sourceFiles("components/onboarding")) {
      expect(readSource(file)).not.toContain("clamp-[")
    }
  })

  test("does not introduce fluid utilities into app chrome", () => {
    const appChromeDirectories = [
      "app/(app)",
      "components/cards",
      "components/grades",
      "components/subjects",
    ]

    const offenders = appChromeDirectories.flatMap((directory) =>
      sourceFiles(directory).filter((file) =>
        readSource(file).includes("clamp-[")
      )
    )

    expect(offenders).toEqual([])
  })
})
