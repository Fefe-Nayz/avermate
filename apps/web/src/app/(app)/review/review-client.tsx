"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { PlayIcon, SparklesIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import dynamic from "next/dynamic"
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
const subscribeToHydration = () => () => undefined

const YearReviewStory = dynamic(
  () =>
    import("@/components/review/year-review-story").then(
      (module) => module.YearReviewStory
    ),
  { ssr: false }
)

export function ReviewClient({
  initialTopPercentile,
}: {
  initialTopPercentile: number
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { subjects, year, yearId, yearGraph } = useYear()
  const [playing, setPlaying] = useState(false)
  // The selected year can come from browser storage after hydration. Keep the
  // server percentile for the hydration frame, then follow the active query.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  )

  const status = useQuery({
    ...orpc.review.status.queryOptions({
      input: reviewStatusInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
  })

  const review = useMemo(() => {
    if (!year) return null
    return buildYearReview(
      subjects,
      year,
      hydrated ? (status.data?.topPercentile ?? 0) : initialTopPercentile
    )
  }, [
    hydrated,
    initialTopPercentile,
    status.data?.topPercentile,
    subjects,
    year,
  ])

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
          // The poster for the story it opens: the same black frame and
          // coloured glow the recap itself plays in, filling the viewport
          // the way the story will — pressing play is stepping through it.
          <div className="relative flex min-h-[calc(100svh-var(--spacing-tabbar)-var(--spacing-safe-bottom)-9rem)] flex-col overflow-hidden rounded-3xl bg-zinc-950 p-8 text-center text-white ring-1 ring-white/10 md:min-h-[calc(100svh-14rem)]">
            <span
              aria-hidden
              className="pointer-events-none absolute -top-32 left-1/2 size-96 -translate-x-1/2 rounded-full bg-primary/35 blur-3xl"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-28 -left-20 size-80 rounded-full bg-orange-500/25 blur-3xl"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/3 -right-24 size-72 rounded-full bg-fuchsia-500/20 blur-3xl"
            />

            <div className="relative flex flex-1 flex-col items-center justify-center py-8">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wider text-white/80 uppercase ring-1 ring-white/15 backdrop-blur-sm">
                <SparklesIcon className="size-3.5" />
                {t("Year in review")}
              </span>
              <h2 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
                {year?.name}
              </h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/70 md:text-base">
                {t(
                  "{count} grades, one story. Take a minute to see how the year actually went.",
                  { count: String(review?.gradeCount ?? 0) }
                )}
              </p>
              <Button
                size="lg"
                className="mt-8 bg-white text-black hover:bg-white/90"
                onClick={() => {
                  haptic("medium")
                  setPlaying(true)
                }}
              >
                <PlayIcon className="size-4" />
                {t("Play my recap")}
              </Button>
            </div>

            {review ? (
              <dl className="relative grid grid-cols-3 gap-3 text-left">
                <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  <dt className="text-xs text-white/60">{t("Grades")}</dt>
                  <dd className="numeric mt-1 text-xl font-semibold">
                    {review.gradeCount}
                  </dd>
                </div>
                <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  <dt className="text-xs text-white/60">
                    {t("Longest streak")}
                  </dt>
                  <dd className="numeric mt-1 text-xl font-semibold">
                    {review.longestStreak}
                  </dd>
                </div>
                <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  <dt className="text-xs text-white/60">
                    {t("Top percentile")}
                  </dt>
                  <dd className="numeric mt-1 text-xl font-semibold">
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
