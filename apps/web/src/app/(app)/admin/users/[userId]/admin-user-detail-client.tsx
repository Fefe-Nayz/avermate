"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  CalendarDaysIcon,
  CheckCircle2Icon,
  FlameIcon,
  KeyRoundIcon,
  LaptopIcon,
  ShieldIcon,
  UserXIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import {
  AdminUserActions,
  hasAdminRole,
  type ManagedUser,
} from "@/components/admin/admin-user-actions"
import { AdminActivityChart } from "@/components/charts/admin-activity-chart"
import { ChoiceField } from "@/components/forms/controls"
import { PageMeta } from "@/components/shell/page-chrome"
import { initialsOf } from "@/lib/name"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import type { AdminOverviewRange } from "@/lib/route-query-inputs"

function numberOrDash(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2)
}

export function AdminUserDetailClient({ userId }: { userId: string }) {
  const t = useExtracted()
  const format = useFormatter()
  const router = useRouter()
  const [range, setRange] = useState<AdminOverviewRange>(90)
  const detail = useQuery(
    orpc.admin.user.queryOptions({ input: { userId, days: range } })
  )
  const data = detail.data

  if (!data) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
      <PageMeta title={data.user.name} backHref="/admin/users" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar className="size-14">
            <AvatarImage
              src={data.user.image ?? undefined}
              alt={data.user.name}
            />
            <AvatarFallback className="text-lg">
              {initialsOf(data.user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">
                {data.user.name}
              </h1>
              {hasAdminRole(data.user.role) ? (
                <Badge variant="secondary">
                  <ShieldIcon /> {t("Admin")}
                </Badge>
              ) : null}
              {data.user.emailVerified ? (
                <Badge variant="outline">
                  <CheckCircle2Icon /> {t("Verified")}
                </Badge>
              ) : null}
              {data.user.banned ? (
                <Badge variant="destructive">
                  <UserXIcon /> {t("Suspended")}
                </Badge>
              ) : null}
              {data.user.mokattamThemeAvailable ? (
                <Badge className="bg-orange-600 text-white">
                  <FlameIcon /> {t("Mokattam")}
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {data.user.email}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {data.user.id}
            </p>
          </div>
          <AdminUserActions
            user={data.user as ManagedUser}
            onDeleted={() => router.replace("/admin/users")}
          />
        </div>

        {data.user.banned ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">
              {data.user.banReason ?? t("No suspension reason")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.user.banExpires
                ? t("Expires {date}", {
                    date: format.dateTime(new Date(data.user.banExpires), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })
                : t("No automatic expiry")}
            </p>
          </div>
        ) : null}

        <ChoiceField
          label={t("Activity range")}
          choices={[
            { value: "30", label: t("30 days") },
            { value: "90", label: t("90 days") },
            { value: "180", label: t("180 days") },
            { value: "365", label: t("1 year") },
            { value: "all", label: t("All time") },
          ]}
          value={String(range)}
          onValueChange={(value) =>
            setRange(
              value === "all" ? "all" : (Number(value) as 30 | 90 | 180 | 365)
            )
          }
          columns={3}
        />

        <div className="grid grid-cols-2 gap-3 @lg/main:grid-cols-4">
          {[
            [t("Grades"), format.number(data.totals.grades)],
            [t("Subjects"), format.number(data.totals.subjects)],
            [t("Years"), format.number(data.totals.years)],
            [t("Custom averages"), format.number(data.totals.customAverages)],
            [t("Average /20"), numberOrDash(data.gradeStats.averageOn20)],
            [t("Best /20"), numberOrDash(data.gradeStats.bestOn20)],
            [t("Lowest /20"), numberOrDash(data.gradeStats.worstOn20)],
            [t("Sessions"), format.number(data.totals.sessions)],
          ].map(([label, value]) => (
            <Card key={label} className="gap-1 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-xs text-muted-foreground">
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="numeric text-2xl font-semibold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("Grade activity")}</CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            <AdminActivityChart
              ariaLabel={t("Grade activity for {name}", {
                name: data.user.name,
              })}
              countLabel={t("Grades recorded")}
              data={data.timeline}
              formatCount={(count) => format.number(count)}
            />
          </CardContent>
        </Card>

        <div className="grid items-start gap-3 @lg/main:grid-cols-2">
          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("Academic years")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="divide-y">
                {data.years.map((year) => (
                  <li
                    key={year.id}
                    className="flex items-center gap-3 py-2 first:pt-0"
                  >
                    <CalendarDaysIcon className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {year.name}
                    </span>
                    {year.archivedAt ? (
                      <Badge variant="outline">{t("Archived")}</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("Linked sign-ins")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 px-4">
              {data.providers.map((provider) => (
                <Badge
                  key={`${provider.providerId}:${provider.createdAt}`}
                  variant="secondary"
                >
                  <KeyRoundIcon /> {provider.providerId}
                </Badge>
              ))}
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("Recent sessions")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="divide-y">
                {data.sessions.map((session) => (
                  <li key={session.id} className="flex gap-3 py-2 first:pt-0">
                    <LaptopIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs">
                        {session.userAgent ?? t("Unknown device")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {session.ipAddress ?? t("Unknown IP")} ·{" "}
                        {format.dateTime(new Date(session.updatedAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("Top subjects")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="divide-y">
                {data.topSubjects.map((subject) => (
                  <li
                    key={subject.id}
                    className="flex items-center gap-2 py-2 first:pt-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
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

        <Card className="py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t("Recent grades")}</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <ul className="divide-y">
              {data.recentGrades.map((grade) => (
                <li
                  key={grade.id}
                  className="flex items-center gap-3 py-2 first:pt-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{grade.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {grade.subjectName}
                    </p>
                  </div>
                  <p className="numeric text-sm font-semibold">
                    {grade.value}/{grade.outOf}
                  </p>
                  <p className="hidden text-xs text-muted-foreground sm:block">
                    {format.dateTime(new Date(grade.passedAt), {
                      dateStyle: "medium",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
