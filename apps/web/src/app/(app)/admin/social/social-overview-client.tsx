"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  FlagIcon,
  HandshakeIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import { SocialHeading, SocialSection } from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"

/**
 * Moderation at a glance. There is no rollout switch any more — social is
 * part of the product — so this page is four counts and two doors.
 */
export function AdminSocialOverviewClient() {
  const t = useExtracted()
  const overview = useQuery(orpc.admin.socialOverview.queryOptions())

  const stats = [
    {
      icon: HandshakeIcon,
      label: t("Friendships"),
      value: overview.data?.friendships,
    },
    {
      icon: UsersRoundIcon,
      label: t("Classes"),
      value: overview.data?.groups,
    },
    {
      icon: FlagIcon,
      label: t("Open reports"),
      value: overview.data?.openReports,
    },
    {
      icon: ShieldCheckIcon,
      label: t("Sharing profiles"),
      value: overview.data?.profiles,
    },
  ]

  return (
    <>
      <PageMeta title={t("Social moderation")} />
      <div className="flex flex-col gap-4">
        <SocialHeading
          icon={ShieldCheckIcon}
          title={t("Social moderation")}
          description={t(
            "Reports and class holds. Academic figures never appear here."
          )}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col gap-1 rounded-xl border bg-card p-4"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <stat.icon className="size-3.5" aria-hidden />
                {stat.label}
              </span>
              <span className="numeric text-2xl font-semibold">
                {stat.value ?? <Spinner className="size-4" />}
              </span>
            </div>
          ))}
        </div>
        <SocialSection title={t("Queues")}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<Link href="/admin/social/reports" />}>
              <FlagIcon /> {t("Review reports")}
            </Button>
            <Button variant="outline" render={<Link href="/admin/social/groups" />}>
              <UsersRoundIcon /> {t("Browse classes")}
            </Button>
          </div>
        </SocialSection>
      </div>
    </>
  )
}
