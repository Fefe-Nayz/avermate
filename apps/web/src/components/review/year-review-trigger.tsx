"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { CalendarDaysIcon, PlayIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useExtracted } from "next-intl"
import dynamic from "next/dynamic"
import { buildYearReview } from "@avermate/core"
import { Button } from "@/components/ui/button"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { yearReviewWindowKey } from "@/lib/year-review-window"

const YearReviewStory = dynamic(
  () => import("./year-review-story").then((module) => module.YearReviewStory),
  { ssr: false }
)

/**
 * The one-time seasonal invitation from the original app, rebuilt as a small
 * client island. Its status query is prefetched by the authenticated server
 * layout only while a review window is open, so this never adds a browser
 * waterfall to the dashboard.
 */
export function YearReviewTrigger() {
  const t = useExtracted()
  const pathname = usePathname()
  const { now, subjects, year, yearId } = useYear()
  const [playing, setPlaying] = useState(false)
  const [invitationKey, setInvitationKey] = useState<string | null>(null)
  const [handledKey, setHandledKey] = useState<string | null>(null)

  const reviewKey = useMemo(
    () =>
      year
        ? yearReviewWindowKey(
            new Date(now),
            new Date(year.startsAt),
            new Date(year.endsAt)
          )
        : null,
    [now, year]
  )

  const status = useQuery({
    ...orpc.review.status.queryOptions({
      input: { yearId: yearId ?? "", reviewKey: reviewKey ?? "annual" },
    }),
    enabled: Boolean(yearId && reviewKey && pathname === "/dashboard"),
  })

  const review = useMemo(
    () =>
      year && status.data?.available
        ? buildYearReview(
            subjects,
            year,
            status.data.topPercentile,
            new Date(now)
          )
        : null,
    [now, status.data, subjects, year]
  )

  useEffect(() => {
    if (
      pathname !== "/dashboard" ||
      !reviewKey ||
      !review ||
      status.data?.seen ||
      handledKey === reviewKey
    )
      return

    const dismissed = sessionStorage.getItem(
      `avermate:review-dismissed:${yearId}:${reviewKey}`
    )
    if (dismissed) return

    const timer = setTimeout(() => setInvitationKey(reviewKey), 1_800)
    return () => clearTimeout(timer)
  }, [handledKey, pathname, review, reviewKey, status.data?.seen, yearId])

  const visible =
    invitationKey === reviewKey &&
    pathname === "/dashboard" &&
    Boolean(
      reviewKey && review && !status.data?.seen && handledKey !== reviewKey
    )

  const dismiss = () => {
    if (!reviewKey) return
    setInvitationKey(null)
    setHandledKey(reviewKey)
    sessionStorage.setItem(
      `avermate:review-dismissed:${yearId}:${reviewKey}`,
      "1"
    )
  }

  const play = () => {
    if (!reviewKey) return
    haptic("medium")
    setInvitationKey(null)
    setHandledKey(reviewKey)
    setPlaying(true)
  }

  return (
    <>
      <AnimatePresence>
        {visible && review && year ? (
          <motion.aside
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", bounce: 0.12, duration: 0.45 }}
            aria-label={t("Year recap available")}
            className="fixed right-[calc(var(--spacing-safe-right)+1rem)] bottom-[calc(var(--spacing-tabbar)+var(--spacing-safe-bottom)+1rem)] left-[calc(var(--spacing-safe-left)+1rem)] z-40 mx-auto max-w-sm rounded-2xl border bg-popover/96 p-4 text-popover-foreground shadow-2xl backdrop-blur-xl md:right-[calc(var(--spacing-safe-right)+1.75rem)] md:bottom-[calc(var(--spacing-safe-bottom)+1.75rem)] md:left-auto md:mx-0"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarDaysIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {t("Your {year} recap is ready", { year: year.name })}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t(
                    "{count} grades, your strongest subjects, your best run and the title you earned.",
                    { count: String(review.gradeCount) }
                  )}
                </p>
                <Button type="button" size="sm" className="mt-3" onClick={play}>
                  <PlayIcon className="size-3.5" />
                  {t("Play my recap")}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={dismiss}
                aria-label={t("Dismiss")}
                className="-mt-1 -mr-1 shrink-0 text-muted-foreground"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      {playing && review && year && reviewKey ? (
        <YearReviewStory
          review={review}
          reviewKey={reviewKey}
          year={year}
          onClose={() => setPlaying(false)}
        />
      ) : null}
    </>
  )
}
