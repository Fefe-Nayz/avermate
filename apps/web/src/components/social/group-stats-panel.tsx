"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChartNoAxesColumnIcon, LockKeyholeIcon, TrophyIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  DistributionBar,
  ExposureBadge,
  SocialCallout,
  SocialSection,
  useSocialLabels,
} from "@/components/social/social-ui"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"
import type { SocialExposure, SocialMetric } from "@/lib/social-presentation"

interface MetricField {
  fieldKey: SocialMetric
  exposure: SocialExposure
}

/**
 * One comparison.
 *
 * A five-number summary is a shape, not five numbers, and the old panel drew
 * it as five identical tiles that hid where the group actually sits. The
 * suppression notice matters as much as the figures: a protected metric is a
 * working privacy threshold, not a missing panel.
 */
function MetricPanel({
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
  const labels = useSocialLabels()
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

  return (
    <SocialSection
      icon={ChartNoAxesColumnIcon}
      title={labels.metric(field.fieldKey)}
      action={<ExposureBadge exposure={field.exposure} />}
    >
      {!stats.data?.available ? (
        <SocialCallout
          icon={LockKeyholeIcon}
          title={t("Protected until the cohort is large enough")}
        >
          {t(
            "Avermate does not reveal how close the group is to the threshold — that number would itself leak the cohort size."
          )}
        </SocialCallout>
      ) : stats.data.summary ? (
        <DistributionBar
          minimum={stats.data.summary.minimum}
          lowerQuartile={stats.data.summary.lowerQuartile}
          median={stats.data.summary.median}
          upperQuartile={stats.data.summary.upperQuartile}
          maximum={stats.data.summary.maximum}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {stats.data.buckets.map((bucket) => (
            <li
              key={bucket.key}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                bucket.suppressed
                  ? "bg-muted/50 text-muted-foreground"
                  : "bg-primary/8"
              )}
            >
              {bucket.suppressed ? (
                <>
                  <LockKeyholeIcon className="size-3.5 shrink-0" aria-hidden />
                  {t("Protected small range")}
                </>
              ) : (
                labels.band(bucket.key)
              )}
            </li>
          ))}
        </ul>
      )}

      {rankingAvailable ? (
        <div className="flex flex-col gap-3 border-t pt-4">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="flex items-center gap-2 text-sm font-medium">
                <TrophyIcon className="size-4 shrink-0" aria-hidden />
                {t("Show my alias in the ranking")}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {t(
                  "A separate choice, off by default. Turning it off removes your alias without withdrawing aggregate sharing."
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
                "The ranking stays hidden until enough people have separately opted in."
              )}
            </p>
          ) : rankings.data.mode === "private_percentile" ? (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm">
              {t("Your private position")}:{" "}
              <span className="font-medium">
                {rankings.data.viewerPercentileBand
                  ? labels.band(rankings.data.viewerPercentileBand)
                  : t("Not available")}
              </span>
            </p>
          ) : (
            <ol className="divide-y rounded-lg border">
              {rankings.data.entries.map((entry) => (
                <li
                  key={entry.membershipId}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <span className="numeric w-7 text-sm font-semibold text-muted-foreground">
                    {entry.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {entry.alias}
                  </span>
                  <span className="numeric text-sm font-medium">
                    {entry.score.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </SocialSection>
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

  if (fields.length === 0) {
    return (
      <SocialCallout title={t("This policy requests no comparisons")}>
        {t("Nothing is derived from your account for this group.")}
      </SocialCallout>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          "Derived values are rounded, small groups and small buckets are suppressed, and ranking thresholds are stricter than aggregate ones."
        )}
      </p>
      <div className="grid gap-3 @3xl/main:grid-cols-2">
        {fields.map((field) => (
          <MetricPanel
            key={field.fieldKey}
            groupId={groupId}
            field={field}
            rankingsEnabled={rankingsEnabled}
            rankingOptedIn={viewerRankingOptIns.includes(field.fieldKey)}
          />
        ))}
      </div>
    </div>
  )
}
