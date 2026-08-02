"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MegaphoneIcon, MessageSquareIcon, UsersIcon } from "lucide-react";
import { useFormatter, useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { PageMeta } from "@/components/shell/page-chrome";
import { orpc } from "@/lib/orpc";

export default function AdminPage() {
  const t = useExtracted();
  const format = useFormatter();
  const overview = useQuery(orpc.admin.overview.queryOptions({ input: { days: 30 } }));

  const data = overview.data;

  const tiles = [
    { label: t("Accounts"), value: data?.totals.users ?? 0 },
    { label: t("Years"), value: data?.totals.years ?? 0 },
    { label: t("Subjects"), value: data?.totals.subjects ?? 0 },
    { label: t("Grades"), value: data?.totals.grades ?? 0 },
  ];

  return (
    <>
      <PageMeta title={t("Admin")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Admin")}</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" render={<Link href="/admin/users" />}>
              <UsersIcon className="size-4" />
              {t("Users")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/admin/announcements" />}
            >
              <MegaphoneIcon className="size-4" />
              {t("Announcements")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/admin/feedback" />}
            >
              <MessageSquareIcon className="size-4" />
              {t("Feedback")}
            </Button>
          </div>
        </div>

        {overview.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 @md/main:grid-cols-4">
          {tiles.map((tile) => (
            <Card key={tile.label} className="gap-1 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {tile.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="numeric text-2xl font-semibold">
                  {format.number(tile.value)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-3 @lg/main:grid-cols-2">
          <Card className="gap-1 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">
                {t("Active this week")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <p className="numeric text-3xl font-semibold">
                {format.number(data?.weeklyActiveUsers ?? 0)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("{count} feedback messages waiting", {
                  count: String(data?.openFeedback ?? 0),
                })}
              </p>
            </CardContent>
          </Card>

          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">
                {t("Grades recorded, last 30 days")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data?.gradeActivity ?? []}>
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={30}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis hide />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="var(--chart-1)"
                      fill="var(--chart-1)"
                      fillOpacity={0.2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
