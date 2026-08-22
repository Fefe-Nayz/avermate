import { describe, expect, test } from "bun:test"
import {
  ADMIN_OVERVIEW_INPUT,
  agendaMonthInput,
  adminUsersInput,
  gradeAttachmentsInput,
  reviewStatusInput,
} from "./route-query-inputs"
import {
  adminFeedbackQueueInput,
  INITIAL_ADMIN_FEEDBACK_FILTERS,
} from "./admin-feedback-query"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

const routes = [
  {
    page: "../app/(app)/review/page.tsx",
    client: "../app/(app)/review/review-client.tsx",
    query: "review.status.queryOptions",
  },
  {
    page: "../app/(app)/admin/page.tsx",
    client: "../app/(app)/admin/admin-overview-client.tsx",
    query: "admin.overview.queryOptions",
  },
  {
    page: "../app/(app)/admin/users/page.tsx",
    client: "../app/(app)/admin/users/admin-users-client.tsx",
    query: "admin.users.queryOptions",
  },
  {
    page: "../app/(app)/admin/feedback/page.tsx",
    client: "../app/(app)/admin/feedback/admin-feedback-client.tsx",
    query: "admin.feedbackQueue.queryOptions",
  },
  {
    page: "../app/(app)/admin/social/groups/page.tsx",
    client: "../app/(app)/admin/social/groups/social-groups-client.tsx",
    query: "admin.socialGroups.queryOptions",
  },
  {
    page: "../app/(app)/admin/social/reports/page.tsx",
    client: "../app/(app)/admin/social/reports/social-reports-client.tsx",
    query: "admin.socialReports.queryOptions",
  },
  {
    page: "../app/(app)/admin/announcements/page.tsx",
    client: "../app/(app)/admin/announcements/admin-announcements-client.tsx",
    query: "admin.announcements.queryOptions",
  },
  {
    page: "../app/(app)/settings/page.tsx",
    client: "../components/settings/avatar-editor.tsx",
    query: "profile.uploadsEnabled.queryOptions",
  },
  {
    page: "../app/(app)/grades/[gradeId]/layout.tsx",
    client: "../components/grades/grade-copies.tsx",
    query: "grades.attachments.queryOptions",
  },
  {
    page: "../app/(app)/settings/integrations/page.tsx",
    client: "../app/(app)/settings/integrations/service-keys-section.tsx",
    query: "serviceKeys.metadata.queryOptions",
  },
] as const

describe("route-specific SSR prefetch", () => {
  test("every initial oRPC read has a server page and hydrated client island", async () => {
    await Promise.all(
      routes.map(async (route) => {
        const [page, client] = await Promise.all([
          source(route.page),
          source(route.client),
        ])

        expect(page).not.toContain('"use client"')
        expect(page).not.toContain("useQuery")
        expect(
          page.includes("createServerQueryClient") ||
            page.includes("prepareAuthenticatedShell")
        ).toBe(true)
        expect(page).toContain("HydrateClient")
        expect(page).toContain(route.query)

        expect(client).toContain('"use client"')
        expect(client).toContain("useQuery")
        expect(client).toContain(route.query)
      })
    )
  })

  test("server and client share deterministic first-render inputs", () => {
    const month = new Date(2026, 7, 20, 12)
    const agenda = agendaMonthInput("year-1", month)
    expect(agenda.yearId).toBe("year-1")
    expect(agenda.from).toEqual(new Date(2026, 7, 1))
    expect(agenda.to).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999))
    expect(reviewStatusInput("year-1")).toEqual({
      yearId: "year-1",
      reviewKey: "annual",
    })
    expect(gradeAttachmentsInput("grade-1")).toEqual({ gradeId: "grade-1" })
    expect(ADMIN_OVERVIEW_INPUT).toEqual({ days: 30 })
    expect(adminUsersInput("")).toEqual({ query: "", limit: 20, offset: 0 })
    expect(adminFeedbackQueueInput(INITIAL_ADMIN_FEEDBACK_FILTERS)).toEqual({
      statuses: ["open"],
      priorities: [],
      kinds: [],
      source: "all",
      assignee: "all",
      label: null,
      search: "",
      limit: 50,
      offset: 0,
    })
  })

  test("the admin subtree is authorized on the server before route reads", async () => {
    const [
      layout,
      guard,
      overview,
      users,
      feedback,
      announcements,
      socialGroups,
      socialReports,
    ] = await Promise.all([
      source("../app/(app)/admin/layout.tsx"),
      source("./admin-data.ts"),
      source("../app/(app)/admin/page.tsx"),
      source("../app/(app)/admin/users/page.tsx"),
      source("../app/(app)/admin/feedback/page.tsx"),
      source("../app/(app)/admin/announcements/page.tsx"),
      source("../app/(app)/admin/social/groups/page.tsx"),
      source("../app/(app)/admin/social/reports/page.tsx"),
    ])

    expect(layout).not.toContain('"use client"')
    expect(layout).not.toContain("useIsAdmin")
    expect(layout).toContain("requireServerAdmin")
    expect(guard).toContain("requireServerViewer")
    expect(guard).toContain("admin.access.queryOptions")
    expect(guard).toContain("notFound")

    for (const page of [
      overview,
      users,
      feedback,
      announcements,
      socialGroups,
      socialReports,
    ]) {
      expect(page.indexOf("requireServerAdmin()")).toBeLessThan(
        page.indexOf("fetchQuery")
      )
    }
  })

  test("token-sensitive Better Auth account reads remain client-owned", async () => {
    const account = await source("../app/(app)/settings/account/page.tsx")

    expect(account).toContain('"use client"')
    expect(account).toContain("useSession")
    expect(account).toContain("authClient.listSessions")
    expect(account).toContain("authClient.listAccounts")
    expect(account).not.toContain("getServerOrpc")
  })

  test("grade-copy mutations refresh only the attachment read model", async () => {
    const copies = await source("../components/grades/grade-copies.tsx")
    expect(copies).toContain("grades.attachments.queryKey")
    expect(copies).not.toContain("snapshot")
  })

  test("service keys remain write-only browser inputs", async () => {
    const keys = await source(
      "../app/(app)/settings/integrations/service-keys-section.tsx"
    )
    expect(keys).toContain('type="password"')
    expect(keys).toContain("serviceKeys.metadata.queryKey")
    expect(keys).not.toContain("serviceKeys.list")
    expect(keys).not.toContain("sealedKey")
  })

  test("settings keeps only its active-navigation island client-owned", async () => {
    const [layout, navigation] = await Promise.all([
      source("../app/(app)/settings/layout.tsx"),
      source("../app/(app)/settings/settings-navigation.tsx"),
    ])

    expect(layout).not.toContain('"use client"')
    expect(layout).not.toContain("usePathname")
    expect(layout).toContain("SettingsNavigation")
    expect(navigation).toContain('"use client"')
    expect(navigation).toContain("usePathname")
  })
})
