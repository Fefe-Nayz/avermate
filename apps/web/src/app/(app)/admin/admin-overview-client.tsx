"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  ActivityIcon,
  CheckCircle2Icon,
  GraduationCapIcon,
  ListTreeIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { AdminActivityChart } from "@/components/charts/admin-activity-chart"
import { ChoiceField } from "@/components/forms/controls"
import { PageMeta } from "@/components/shell/page-chrome"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import {
  adminOverviewInput,
  INITIAL_ADMIN_OVERVIEW_RANGE,
  type AdminOverviewRange,
} from "@/lib/route-query-inputs"

function percentage(value: number | null | undefined) {
  return `${(value ?? 0).toFixed(1)}%`
}

function decimal(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2)
}

function Metric({
  description,
  label,
  value,
}: {
  description: string
  label: string
  value: string
}) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="numeric text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

export function AdminOverviewClient() {
  const t = useExtracted()
  const format = useFormatter()
  const [range, setRange] = useState<AdminOverviewRange>(
    INITIAL_ADMIN_OVERVIEW_RANGE
  )
  const overview = useQuery(
    orpc.admin.overview.queryOptions({ input: adminOverviewInput(range) })
  )
  const data = overview.data

  const ranges = [
    { value: "30", label: t("30 days") },
    { value: "90", label: t("90 days") },
    { value: "180", label: t("180 days") },
    { value: "365", label: t("1 year") },
    { value: "all" as const, label: t("All time") },
  ]

  return (
    <>
      <PageMeta title={t("Admin")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Administration")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Product health, adoption and account operations.")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/admin/users" />}
            >
              <UsersIcon className="size-4" /> {t("Users")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/admin/announcements" />}
            >
              <MegaphoneIcon className="size-4" /> {t("Announcements")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/admin/feedback" />}
            >
              <MessageSquareIcon className="size-4" /> {t("Feedback")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/admin/presets" />}
            >
              <ListTreeIcon className="size-4" /> {t("Presets")}
            </Button>
          </div>
        </div>

        <ChoiceField
          label={t("Activity range")}
          choices={ranges}
          value={String(range)}
          onValueChange={(value) =>
            setRange(
              value === "all" ? "all" : (Number(value) as 30 | 90 | 180 | 365)
            )
          }
          columns={3}
        />

        {overview.isFetching && !data ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 @lg/main:grid-cols-4">
          <Metric
            label={t("Accounts")}
            value={format.number(data?.totals.users ?? 0)}
            description={t("{count} created in 30 days", {
              count: String(data?.last30Days.newUsers ?? 0),
            })}
          />
          <Metric
            label={t("Grades")}
            value={format.number(data?.totals.grades ?? 0)}
            description={t("{count} added in 30 days", {
              count: String(data?.last30Days.newGrades ?? 0),
            })}
          />
          <Metric
            label={t("Active users")}
            value={format.number(data?.last30Days.activeUsers ?? 0)}
            description={t("Accounts that recorded a grade in 30 days")}
          />
          <Metric
            label={t("Suspended")}
            value={format.number(data?.totals.bannedUsers ?? 0)}
            description={t("{count} administrator accounts", {
              count: String(data?.totals.admins ?? 0),
            })}
          />
          <Metric
            label={t("Verified email")}
            value={percentage(data?.health.verificationRate)}
            description={t("{count} verified accounts", {
              count: String(data?.health.verifiedUsers ?? 0),
            })}
          />
          <Metric
            label={t("Grade adoption")}
            value={percentage(data?.health.adoptionRate)}
            description={t("{count} accounts have recorded a grade", {
              count: String(data?.health.usersWithGrades ?? 0),
            })}
          />
          <Metric
            label={t("Global average")}
            value={decimal(data?.health.globalAverageOn20)}
            description={
              data?.health.passRateOn20 == null
                ? t("Not enough grade data")
                : t("{rate} of account averages are at least 10/20", {
                    rate: percentage(data.health.passRateOn20),
                  })
            }
          />
          <Metric
            label={t("Grades per account")}
            value={decimal(data?.health.averageGradesPerUser)}
            description={t("{count} among active accounts", {
              count: decimal(data?.health.averageGradesPerActiveUser),
            })}
          />
        </div>

        <div className="grid gap-3 @lg/main:grid-cols-2">
          <Card className="gap-2 py-4">
            <CardHeader className="flex-row items-center justify-between px-4">
              <CardTitle className="text-sm font-medium">
                {t("New accounts")}
              </CardTitle>
              <UsersIcon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-2">
              <AdminActivityChart
                ariaLabel={t("New account activity")}
                countLabel={t("New accounts")}
                data={data?.signups ?? []}
                formatCount={(count) => format.number(count)}
              />
            </CardContent>
          </Card>
          <Card className="gap-2 py-4">
            <CardHeader className="flex-row items-center justify-between px-4">
              <CardTitle className="text-sm font-medium">
                {t("Grades recorded")}
              </CardTitle>
              <GraduationCapIcon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-2">
              <AdminActivityChart
                ariaLabel={t("Grade activity")}
                countLabel={t("Grades recorded")}
                data={data?.gradeActivity ?? []}
                formatCount={(count) => format.number(count)}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 @lg/main:grid-cols-3">
          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ActivityIcon className="size-4" /> {t("Last 7 days")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 px-4 text-center">
              <div className="rounded-lg bg-muted p-2">
                <p className="numeric font-semibold">
                  {format.number(data?.last7Days.newUsers ?? 0)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("accounts")}
                </p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <p className="numeric font-semibold">
                  {format.number(data?.last7Days.newGrades ?? 0)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("grades")}
                </p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <p className="numeric font-semibold">
                  {format.number(data?.last7Days.activeUsers ?? 0)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("active")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldIcon className="size-4" /> {t("Roles")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 px-4">
              {data?.distribution.roles.map((entry) => (
                <Badge key={entry.role} variant="secondary">
                  {entry.role} · {format.number(entry.count)}
                </Badge>
              ))}
            </CardContent>
          </Card>

          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CheckCircle2Icon className="size-4" /> {t("Sign-in providers")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 px-4">
              {data?.distribution.providers.map((entry) => (
                <Badge key={entry.providerId} variant="outline">
                  {entry.providerId} · {format.number(entry.count)}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 @lg/main:grid-cols-2">
          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">
                {t("Most active accounts")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="divide-y">
                {data?.topUsers.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-center gap-3 py-2 first:pt-0"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {user.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {t("{count} grades", { count: String(user.gradeCount) })}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">
                {t("Most used subjects")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="divide-y">
                {data?.topSubjects.map((subject) => (
                  <li
                    key={subject.id}
                    className="flex items-center gap-3 py-2 first:pt-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {subject.name}
                    </span>
                    <Badge variant="outline">
                      {t("{count} grades", {
                        count: String(subject.gradeCount),
                      })}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
