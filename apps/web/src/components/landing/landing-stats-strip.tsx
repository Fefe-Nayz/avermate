"use client"

import NumberFlow from "@number-flow/react"
import { useExtracted } from "next-intl"
import {
  BackgroundDots,
  useOnScreen,
} from "@/components/landing/landing-chrome"

/**
 * The counters.
 *
 * Only real aggregates go in this strip. It is tempting to pad it out to four
 * columns with "100% free" or "2 platforms", but a claim standing in a row of
 * measurements reads as a measurement — the same mistake the social hub made
 * by putting "Invite only" beside a friend count. Three true numbers, or none.
 */
export function LandingStatsStrip({
  users,
  subjects,
  grades,
}: {
  users: number
  subjects: number
  grades: number
}) {
  const t = useExtracted()
  const { ref, inView } = useOnScreen<HTMLDivElement>()

  const stats = [
    { value: users, label: t("students") },
    { value: subjects, label: t("subjects tracked") },
    { value: grades, label: t("grades recorded") },
  ]

  return (
    <div
      ref={ref}
      className="relative overflow-hidden border-y border-border/60 bg-muted/25"
    >
      <BackgroundDots />
      <dl className="relative mx-auto grid max-w-6xl grid-cols-3 divide-border/60 clamp-[py,8,10] pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))] lg:divide-x">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className="flex flex-col items-center gap-1 text-center"
          >
            <dt className="sr-only">{stat.label}</dt>
            <dd className="numeric font-mono clamp-[text,2xl,4xl] font-semibold tracking-tight">
              <NumberFlow
                value={inView ? stat.value : 0}
                format={{ notation: "compact", maximumFractionDigits: 1 }}
                transformTiming={{
                  duration: 900 + index * 150,
                  easing: "ease-out",
                }}
              />
            </dd>
            <p aria-hidden className="max-w-32 text-xs text-muted-foreground">
              {stat.label}
            </p>
          </div>
        ))}
      </dl>
    </div>
  )
}
