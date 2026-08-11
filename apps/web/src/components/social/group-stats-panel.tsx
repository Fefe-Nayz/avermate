"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BarChart3Icon, LockKeyholeIcon, TrophyIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { orpc } from "@/lib/orpc"
import type {
  MetricExposure,
  SocialMetric,
} from "@/components/social/group-policy-editor"

interface MetricField {
  fieldKey: SocialMetric
  exposure: MetricExposure
}

function MetricCard({
  groupId,
  field,
  rankingsEnabled,
  rankingOptedIn,
}: {
  groupId: string
  field: MetricField
  rankingsEnabled: boolean
  rankingOptedIn: boolean
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const stats = useQuery(
    orpc.social.groups.stats.queryOptions({
      input: { groupId, metric: field.fieldKey },
    })
  )
  const rankingAvailable = rankingsEnabled && field.exposure === "ranking"
  const rankings = useQuery({
    ...orpc.social.groups.rankings.queryOptions({
      input: { groupId, metric: field.fieldKey },
    }),
    enabled: rankingAvailable,
  })
  const setRanking = useMutation({
    ...orpc.social.groups.policy.setRankingOptIn.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.policy.current.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.rankings.key(),
        }),
      ])
    },
  })

  function metricLabel(metric: SocialMetric) {
    if (metric === "normalizedAverage") return t("Normalized average")
    if (metric === "median") return t("Median result")
    if (metric === "trendBand") return t("Trend range")
    if (metric === "passRateBand") return t("Success-rate range")
    if (metric === "gradeCountBand") return t("Activity range")
    return t("Goal progress range")
  }

  function bandLabel(value: string) {
    if (value === "improving") return t("Improving")
    if (value === "stable") return t("Stable")
    if (value === "declining") return t("Declining")
    if (value === "high") return t("High")
    if (value === "medium") return t("Medium")
    if (value === "low") return t("Low")
    if (value === "top_quartile") return t("Top quartile")
    if (value === "upper_middle") return t("Upper-middle quartile")
    if (value === "lower_middle") return t("Lower-middle quartile")
    if (value === "bottom_quartile") return t("Bottom quartile")
    return t("Other protected range")
  }

  return (
    <Card className="py-4">
      <CardHeader className="flex-row items-start justify-between px-4">
        <div>
          <CardTitle className="text-sm">
            {metricLabel(field.fieldKey)}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {field.exposure === "aggregate_only"
              ? t("Aggregate only")
              : field.exposure === "member_visible"
                ? t("Member-visible under consent")
                : t("Aggregate plus optional ranking")}
          </p>
        </div>
        <BarChart3Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        {!stats.data?.available ? (
          <Alert>
            <LockKeyholeIcon aria-hidden />
            <AlertTitle>
              {t("Protected until the cohort is large enough")}
            </AlertTitle>
            <AlertDescription>
              {t(
                "Avermate does not reveal the exact near-threshold participant count. The panel appears only after the privacy minimum is safely met."
              )}
            </AlertDescription>
          </Alert>
        ) : stats.data.summary ? (
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {[
              [t("Minimum"), stats.data.summary.minimum],
              [t("Lower quartile"), stats.data.summary.lowerQuartile],
              [t("Median"), stats.data.summary.median],
              [t("Upper quartile"), stats.data.summary.upperQuartile],
              [t("Maximum"), stats.data.summary.maximum],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg bg-muted/60 p-2 text-center"
              >
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm font-semibold">
                  {typeof value === "number" ? `${value.toFixed(1)}%` : "—"}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="flex flex-wrap gap-2">
            {stats.data.buckets.map((bucket) =>
              bucket.suppressed ? (
                <Badge key={bucket.key} variant="outline">
                  {t("Protected small range")}
                </Badge>
              ) : (
                <Badge key={bucket.key} variant="secondary">
                  {bandLabel(bucket.key)}
                </Badge>
              )
            )}
          </div>
        )}

        {rankingAvailable ? (
          <div className="space-y-3 border-t pt-4">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <TrophyIcon className="size-4" /> {t("Named ranking opt-in")}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {t(
                    "This separate choice is off by default. Disabling it removes your alias from the ranking without withdrawing aggregate sharing."
                  )}
                </span>
              </span>
              <Switch
                checked={rankingOptedIn}
                disabled={setRanking.isPending}
                onCheckedChange={(enabled) =>
                  setRanking.mutate({
                    groupId,
                    metric: field.fieldKey,
                    enabled,
                  })
                }
              />
            </label>

            {!rankings.data?.available ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(
                  "Ranking remains hidden until enough separately opted-in eligible participants exist. The exact near-threshold count is not shown."
                )}
              </p>
            ) : rankings.data.mode === "private_percentile" ? (
              <p className="rounded-lg bg-muted p-3 text-sm">
                {t("Your private position")}:{" "}
                {rankings.data.viewerPercentileBand
                  ? bandLabel(rankings.data.viewerPercentileBand)
                  : t("Not available")}
              </p>
            ) : (
              <ol className="divide-y rounded-lg border">
                {rankings.data.entries.map((entry) => (
                  <li
                    key={entry.membershipId}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <span className="w-8 text-sm font-semibold">
                      #{entry.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {entry.alias}
                    </span>
                    <span className="text-sm tabular-nums">
                      {entry.score.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function GroupStatsPanel({
  groupId,
  fields,
  rankingsEnabled,
  viewerRankingOptIns,
}: {
  groupId: string
  fields: MetricField[]
  rankingsEnabled: boolean
  viewerRankingOptIns: SocialMetric[]
}) {
  const t = useExtracted()
  return (
    <section className="space-y-3" aria-labelledby="group-statistics-heading">
      <div>
        <h2 id="group-statistics-heading" className="text-lg font-semibold">
          {t("Protected group statistics")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Derived values are rounded. Small groups and buckets are suppressed; ranking thresholds are stricter."
          )}
        </p>
      </div>
      <div className="grid gap-3 @xl/main:grid-cols-2">
        {fields.map((field) => (
          <MetricCard
            key={field.fieldKey}
            groupId={groupId}
            field={field}
            rankingsEnabled={rankingsEnabled}
            rankingOptedIn={viewerRankingOptIns.includes(field.fieldKey)}
          />
        ))}
      </div>
    </section>
  )
}
