import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

const routeFiles = [
  "app/layout.tsx",
  "app/page.tsx",
  "app/legal/layout.tsx",
  "app/legal/privacy/page.tsx",
  "app/legal/terms/page.tsx",
  "app/auth/layout.tsx",
  "app/auth/sign-in/page.tsx",
  "app/auth/sign-up/page.tsx",
  "app/auth/forgot-password/page.tsx",
  "app/auth/reset-password/page.tsx",
  "app/auth/verify/page.tsx",
] as const

const authPages = routeFiles.filter(
  (path) => path.startsWith("app/auth/") && path.endsWith("page.tsx")
)

const clientIslands = [
  "components/auth/social-buttons.tsx",
  "components/auth/sign-in-form.tsx",
  "components/auth/sign-up-form.tsx",
  "components/auth/forgot-password-form.tsx",
  "components/auth/reset-password-form.tsx",
  "components/auth/verify-email-form.tsx",
] as const

describe("public, legal, and auth route boundaries", () => {
  it("keeps every audited page and layout server-owned", () => {
    assert.equal(routeFiles.length, 11)
    for (const path of routeFiles) {
      assert.doesNotMatch(source(path), /^\s*["']use client["']/m, path)
    }
  })

  it("keeps browser auth behavior inside explicit client islands", () => {
    for (const path of clientIslands) {
      assert.match(source(path), /^\s*["']use client["']/m, path)
    }

    for (const path of authPages) {
      const page = source(path)
      assert.doesNotMatch(
        page,
        /\b(?:authClient|haptic|toast|useEffect|useRouter|useSearchParams|useState)\b/,
        path
      )
    }
  })

  it("resolves URL state on the server and exposes route metadata", () => {
    for (const path of authPages) {
      assert.match(source(path), /export const metadata:/, path)
    }

    for (const path of [
      "app/auth/sign-in/page.tsx",
      "app/auth/reset-password/page.tsx",
      "app/auth/verify/page.tsx",
    ]) {
      const page = source(path)
      assert.match(page, /searchParams: Promise</, path)
      assert.match(page, /use\(searchParams\)/, path)
      assert.doesNotMatch(page, /<Suspense|useSearchParams/, path)
    }
  })
})
