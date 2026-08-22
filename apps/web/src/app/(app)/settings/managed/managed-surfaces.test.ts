import { describe, expect, test } from "bun:test"

const read = (relative: string) =>
  Bun.file(new URL(relative, import.meta.url)).text()

describe("managed beta Web surfaces", () => {
  test("customer surface covers consent, authoritative usage and lifecycle truth", async () => {
    const source = await read("./managed-service-client.tsx")
    expect(source).toContain("orpc.managed.beta.redeemInvite")
    expect(source).toContain("orpc.managed.beta.updateConsent")
    expect(source).toContain("Authoritative usage")
    expect(source).toContain("Pending remote deletion")
    expect(source).toContain("Core / BYOK / Node")
    expect(source).toContain("Checkout off")
    expect(source).toContain(
      '<CardContent className="text-sm text-muted-foreground">'
    )
    expect(source).toContain("useOnlineStatus")
    expect(source).toContain("disabled={!isOnline}")
    expect(source).toContain('t("Managed status is unavailable")')
    expect(source).toContain("orpc.managed.usage.reservations.queryOptions")
    expect(source).toContain("orpc.managed.usage.run.queryOptions")
    expect(source).toContain('t("Reservation ledger")')
    expect(source).toContain('t("Estimated")')
    expect(source).toContain('t("Settled")')
  })

  test("operator surface covers guarded admission, quotas, evidence and billing test mode", async () => {
    const source = await read(
      "../../admin/managed/managed-operations-client.tsx"
    )
    expect(source).toContain("orpc.managed.admin.beta.issueInvite")
    expect(source).toContain("orpc.managed.admin.beta.upsertQuotaPolicy")
    expect(source).toContain("orpc.managed.admin.circuitBreaker")
    expect(source).toContain("orpc.managed.admin.operations.recordEvidence")
    expect(source).toContain("repository-fixture")
    expect(source).toContain("Production checkout is hard-disabled")
    expect(source).not.toContain("createCheckout.mutationOptions")
    expect(source).toContain("useOnlineStatus")
    expect(source).toContain("disabled={!isOnline}")
    expect(source).toContain('aria-label={t("Loading managed operations")}')
    expect(source).toContain("data.pools")
    expect(source).toContain("data.reservations")
    expect(source).toContain("data.deletionBacklog")
    expect(source).toContain("data.storage")
    expect(source).toContain('t("Operational queues and capacity")')
  })

  test("both surfaces are reachable from their role-appropriate navigation", async () => {
    const [nav, labels, adminNavigation] = await Promise.all([
      read("../../../../lib/nav.ts"),
      read("../../../../lib/nav-labels.ts"),
      read("../../admin/admin-navigation.tsx"),
    ])
    expect(nav).toContain('href: "/settings/managed"')
    expect(labels).toContain('"AI & managed storage"')
    expect(adminNavigation).toContain('href: "/admin/managed"')
  })
})
