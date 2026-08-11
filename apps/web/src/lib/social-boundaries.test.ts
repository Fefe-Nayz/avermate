import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("social server and privacy boundaries", () => {
  test("fails closed before rendering the active social subtree", async () => {
    const [layout, access] = await Promise.all([
      source("../app/(app)/social/(active)/layout.tsx"),
      source("./social-access.ts"),
    ])

    expect(layout).not.toContain('"use client"')
    expect(layout).toContain("socialFeatureIsKnown")
    expect(layout).toContain("socialGroupIsAccessible")
    expect(layout).toContain("notFound")
    expect(layout).toContain('redirect("/settings/social")')
    expect(access).toContain(
      "A missing/unknown response never makes navigation"
    )
    expect(access).toContain("return Boolean")
  })

  test("hydrates only the interactive islands from shared query options", async () => {
    const pairs = [
      {
        page: "../app/(app)/settings/social/page.tsx",
        client: "../app/(app)/settings/social/social-settings-client.tsx",
        query: "social.eligibility.get.queryOptions",
      },
      {
        page: "../app/(app)/social/(active)/friends/page.tsx",
        client: "../app/(app)/social/(active)/friends/friends-client.tsx",
        query: "social.friends.list.queryOptions",
      },
      {
        page: "../app/(app)/social/(active)/profile/page.tsx",
        client:
          "../app/(app)/social/(active)/profile/profile-sharing-client.tsx",
        query: "social.profile.mine.queryOptions",
      },
    ] as const

    for (const pair of pairs) {
      const [page, client] = await Promise.all([
        source(pair.page),
        source(pair.client),
      ])
      expect(page).not.toContain('"use client"')
      expect(page).toContain("createServerQueryClient")
      expect(page).toContain("HydrateClient")
      expect(page).toContain(pair.query)
      expect(client).toContain('"use client"')
      expect(client).toContain(pair.query)
    }
  })

  test("keeps legacy token routes server-only and disables referrer leakage", async () => {
    const pages = await Promise.all([
      source("../app/(social-consent)/social/guardian/[token]/page.tsx"),
      source(
        "../app/(app)/social/(invitation)/friends/invitations/[token]/page.tsx"
      ),
      source("../app/(app)/social/(invitation)/invitations/[token]/page.tsx"),
    ])

    for (const page of pages) {
      expect(page).not.toContain('"use client"')
      expect(page).toContain('referrer: "no-referrer"')
      expect(page).toContain("noarchive: true")
      expect(page).not.toContain("HydrateClient")
      expect(page).not.toContain("queryOptions")
    }
  })

  test("uses fragment-only canonical invitations and scrubs secrets before preview", async () => {
    const [
      invitationPage,
      invitationBridge,
      invitationReview,
      guardianPage,
      guardianBridge,
      guardianReview,
    ] = await Promise.all([
      source("../app/(social-bridge)/social/invitation/page.tsx"),
      source(
        "../app/(social-bridge)/social/invitation/social-invitation-bridge.tsx"
      ),
      source(
        "../app/(app)/social/(invitation)/invitation/review/social-invitation-review-client.tsx"
      ),
      source("../app/(social-bridge)/social/guardian/page.tsx"),
      source(
        "../app/(social-bridge)/social/guardian/guardian-consent-bridge.tsx"
      ),
      source(
        "../app/(social-consent)/social/guardian/review/guardian-consent-review-client.tsx"
      ),
    ])

    for (const page of [invitationPage, guardianPage]) {
      expect(page).not.toContain('"use client"')
      expect(page).toContain('referrer: "no-referrer"')
      expect(page).toContain("noarchive: true")
      expect(page).not.toContain("searchParams")
      expect(page).not.toContain("[token]")
      expect(page).not.toContain("requireServerViewer")
    }
    for (const bridge of [invitationBridge, guardianBridge]) {
      expect(bridge).toContain("window.location.hash")
      expect(bridge).toContain("window.history.replaceState")
      expect(bridge).toContain("sessionStorage.setItem")
      expect(bridge).toContain("window.location.replace")
      expect(bridge).not.toContain("queryOptions")
    }
    expect(invitationReview).toContain("sessionStorage.removeItem")
    expect(invitationReview).toContain("invitations.preview.queryOptions")
    expect(invitationReview).not.toContain("window.location.hash")
    expect(guardianReview).toContain("sessionStorage.removeItem")
    expect(guardianReview).toContain("guardian.preview.queryOptions")
    expect(guardianReview).not.toContain("window.location.hash")
  })

  test("keeps social queries request-scoped and no-store", async () => {
    const [transport, queryClient] = await Promise.all([
      source("./orpc/server.ts"),
      source("./query-client.ts"),
    ])

    expect(transport).toContain('cache: "no-store"')
    expect(transport).toContain("getServerRpc = cache")
    expect(queryClient).toContain("Create one cache for one server request")
    expect(queryClient).not.toContain("const queryClient = new QueryClient")
  })

  test("guardian consent authenticates without requiring an academic year", async () => {
    const [layout, reviewPage, legacyPage] = await Promise.all([
      source("../app/(social-consent)/layout.tsx"),
      source("../app/(social-consent)/social/guardian/review/page.tsx"),
      source("../app/(social-consent)/social/guardian/[token]/page.tsx"),
    ])

    expect(layout).not.toContain('"use client"')
    expect(layout).toContain("requireServerViewer")
    expect(layout).toContain("AuthenticatedProviders")
    expect(layout).toContain("HydrateClient")
    expect(layout).not.toContain("prepareAuthenticatedShell")
    expect(layout).not.toContain("YearGate")
    expect(layout).not.toContain("YearProvider")
    expect(layout).not.toContain("snapshot.get")
    expect(reviewPage).toContain("requireServerViewer")
    expect(legacyPage).toContain("requireServerViewer")
  })

  test("uses backend projections and never reads the academic snapshot", async () => {
    const files = await Promise.all([
      source("../app/(app)/social/(active)/page.tsx"),
      source("../app/(app)/social/(active)/friends/friends-client.tsx"),
      source("../app/(app)/social/(active)/profile/profile-sharing-client.tsx"),
      source("../components/social/profile-preview.tsx"),
    ])

    for (const file of files) {
      expect(file).not.toContain("snapshot.get")
      expect(file).not.toContain("rawGrades")
      expect(file).not.toContain("subjectId")
      expect(file).not.toContain("userEmail")
    }
    expect(files[2]).toContain("profile.previewMineAs")
  })

  test("keeps avatar formatting in a shared pure helper", async () => {
    const [preview, socialUi, nameHelper, navUser] = await Promise.all([
      source("../components/social/profile-preview.tsx"),
      source("../components/social/social-ui.tsx"),
      source("./name.ts"),
      source("../components/shell/nav-user.tsx"),
    ])

    expect(preview).not.toContain('from "@/components/shell/nav-user"')
    expect(preview).toContain("SocialIdentity")
    expect(socialUi).not.toContain('from "@/components/shell/nav-user"')
    expect(socialUi).toContain('from "@/lib/name"')
    expect(nameHelper).not.toContain('"use client"')
    expect(nameHelper).toContain("export function initialsOf")
    expect(navUser).not.toContain("export function initialsOf")
  })

  test("admin moderation never reads grades or renders opaque audit evidence", async () => {
    const files = await Promise.all([
      source("../app/(app)/admin/social/social-overview-client.tsx"),
      source("../app/(app)/admin/social/groups/social-groups-client.tsx"),
      source("../app/(app)/admin/social/reports/social-reports-client.tsx"),
      source("../components/admin/social-report-detail.tsx"),
      source("../app/(app)/admin/social/audit/social-audit-client.tsx"),
    ])

    for (const file of files) {
      expect(file).not.toContain("snapshot.get")
      expect(file).not.toContain("rawGrades")
      expect(file).not.toContain("gradeValue")
    }
    expect(files[4]).not.toContain("event.requestId")
    expect(files[4]).not.toContain("requestId}")
  })

  test("automatic reports never submit error messages or stacks", async () => {
    const [appBoundary, globalBoundary] = await Promise.all([
      source("../app/(app)/error.tsx"),
      source("../app/global-error.tsx"),
    ])

    for (const boundary of [appBoundary, globalBoundary]) {
      expect(boundary).toContain("autoReport")
      expect(boundary).not.toContain("error.message")
      expect(boundary).not.toContain("error.stack")
    }
  })
})
