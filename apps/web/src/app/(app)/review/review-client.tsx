"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { PlayIcon, SparklesIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { buildYearReview } from "@avermate/core"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageMeta } from "@/components/shell/page-chrome"
import { YearReviewStory } from "@/components/review/year-review-story"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import { reviewStatusInput } from "@/lib/route-query-inputs"

/**
 * The end-of-year recap.
 *
 * Assembled from the year already in memory, with only the percentile coming
 * from the server — the one number that needs everybody else's data.
 */
export function ReviewClient() {
  const t = useExtracted()
  const format = useFormatter()
  const { subjects, year, yearId, yearGraph } = useYear()
  const [playing, setPlaying] = useState(false)

  const status = useQuery({
    ...orpc.review.status.queryOptions({
      input: reviewStatusInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
  })

  const review = useMemo(() => {
    if (!year) return null
    return buildYearReview(subjects, year, status.data?.topPercentile ?? 0)
  }, [subjects, year, status.data?.topPercentile])

  const gradeCount = yearGraph.allGrades().length

  if (playing && review && year) {
    return (
      <YearReviewStory
        review={review}
        year={year}
        onClose={() => setPlaying(false)}
      />
    )
  }

  return (
    <>
      <PageMeta title={t("Year in review")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Year in review")}
        </h1>

        {gradeCount < 5 ? (
          <Empty className="rounded-xl border border-dashed py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle>{t("Not yet")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Record at least five grades and your recap unlocks. {count} so far.",
                  { count: String(gradeCount) }
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/12 via-card to-card p-8 text-center">
            <SparklesIcon className="mx-auto size-8 text-primary" />
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">
              {year?.name}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              {t(
                "{count} grades, one story. Take a minute to see how the year actually went.",
                { count: String(review?.gradeCount ?? 0) }
              )}
            </p>
            <Button
              size="lg"
              className="mt-6"
              onClick={() => {
                haptic("medium")
                setPlaying(true)
              }}
            >
              <PlayIcon className="size-4" />
              {t("Play my recap")}
            </Button>

            {review ? (
              <dl className="mt-8 grid grid-cols-3 gap-4 border-t pt-6 text-left">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("Grades")}
                  </dt>
                  <dd className="numeric text-xl font-semibold">
                    {review.gradeCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("Longest streak")}
                  </dt>
                  <dd className="numeric text-xl font-semibold">
                    {review.longestStreak}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("Top percentile")}
                  </dt>
                  <dd className="numeric text-xl font-semibold">
                    {review.topPercentile > 0
                      ? format.number(review.topPercentile / 100, {
                          style: "percent",
                          maximumFractionDigits: 0,
                        })
                      : "—"}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        )}
      </div>
    </>
  )
}
