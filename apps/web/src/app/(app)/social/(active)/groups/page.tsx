import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRightIcon,
  PlusIcon,
  ShieldAlertIcon,
  UsersRoundIcon,
} from "lucide-react"
import { getExtracted } from "next-intl/server"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  PrivacyBoundaryNotice,
  SocialPageHeading,
} from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getServerRpc } from "@/lib/orpc/server"

export const metadata: Metadata = {
  title: "Groups & self-declared classes",
  description: "Private, consent-based group comparisons.",
  robots: { index: false, follow: false },
}

export default async function SocialGroupsPage() {
  const t = await getExtracted()
  const result = await getServerRpc().social.groups.list()

  function groupType(type: string) {
    if (type === "friends") return t("Friends group")
    if (type === "study_group") return t("Study group")
    return t("Self-declared class group")
  }

  return (
    <>
      <PageMeta title={t("Groups")} backHref="/social" />
      <div className="flex flex-col gap-4">
        <SocialPageHeading
          title={t("Groups & comparisons")}
          description={t(
            "Join private groups under a versioned sharing policy. Aggregates are protected by minimum group sizes; named rankings require separate opt-in."
          )}
          action={
            <Button render={<Link href="/social/groups/new" />}>
              <PlusIcon /> {t("Create group")}
            </Button>
          }
        />

        {result.groups.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 @xl/main:grid-cols-3">
            {result.groups.map((group) => (
              <li key={group.id}>
                <Card className="h-full py-4">
                  <CardHeader className="px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">
                          {group.name}
                        </CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {groupType(group.type)}
                        </p>
                      </div>
                      <Badge variant="outline">{group.memberCount}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex h-full flex-col gap-3 px-4">
                    {group.description ? (
                      <p className="line-clamp-3 text-sm text-muted-foreground">
                        {group.description}
                      </p>
                    ) : null}
                    <div className="mt-auto flex items-center justify-between gap-2">
                      {group.membershipState === "consent_required" ? (
                        <Badge variant="secondary">
                          <ShieldAlertIcon /> {t("Review required")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{t("Policy accepted")}</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        render={<Link href={`/social/groups/${group.id}`} />}
                      >
                        {t("Open")} <ArrowRightIcon />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersRoundIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No groups yet")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Create a private group or join from an invitation that explains its sharing policy first."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <PrivacyBoundaryNotice />
      </div>
    </>
  )
}
