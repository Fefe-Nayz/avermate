"use client"

import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ClockIcon,
  SparklesIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { cn } from "@/lib/utils"

/**
 * The illustrations.
 *
 * Every one of these is drawn, not photographed. A screenshot of a grade
 * tracker is a picture of somebody's marks — which we should not be putting on
 * a public page — and it goes out of date the day the UI moves. These draw the
 * *shape* of each idea with invented numbers, in the app's own tokens, so they
 * follow the reader's theme and can never leak anything real.
 *
 * They are decorative by construction: each is `aria-hidden`, because the
 * claim beside it already says the thing in words.
 */

const EASE = [0.21, 0.47, 0.32, 0.98] as const

function Frame({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "h-full overflow-hidden rounded-xl border bg-background/60 p-3",
        className
      )}
    >
      {children}
    </div>
  )
}

/** Nesting and coefficients — the thing a spreadsheet quietly flattens. */
export function WeightingVisual() {
  const t = useExtracted()
  const rows = [
    { name: t("Sciences"), depth: 0, coefficient: null, value: "13.8" },
    { name: t("Maths"), depth: 1, coefficient: "×5", value: "14.3" },
    { name: t("Physics"), depth: 1, coefficient: "×3", value: "13.0" },
    { name: t("Languages"), depth: 0, coefficient: null, value: "16.0" },
    { name: t("English"), depth: 1, coefficient: "×2", value: "16.0" },
  ]

  return (
    <Frame className="p-0">
      <ul className="divide-y">
        {rows.map((row, index) => (
          <motion.li
            key={row.name}
            initial={{ opacity: 0, x: -6 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: index * 0.06, ease: EASE }}
            className={cn(
              "flex items-center gap-2 py-2 pr-3 text-xs",
              row.depth === 0 && "bg-muted/50 font-medium"
            )}
            style={{ paddingInlineStart: `${0.75 + row.depth * 0.9}rem` }}
          >
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            {row.coefficient ? (
              <span className="numeric rounded border border-dashed px-1 text-[10px] text-muted-foreground">
                {row.coefficient}
              </span>
            ) : null}
            <span className="numeric w-9 text-right font-medium">
              {row.value}
            </span>
          </motion.li>
        ))}
      </ul>
    </Frame>
  )
}

/** A target, and the single number that would get you there. */
export function GoalVisual() {
  const t = useExtracted()
  const reduceMotion = useReducedMotion()

  return (
    <Frame className="flex flex-col justify-between gap-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">
          {t("Target")}
        </span>
        <span className="numeric text-sm font-semibold">14.00</span>
      </div>

      <div className="relative h-2 rounded-full bg-muted">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          initial={{ width: "0%" }}
          whileInView={{ width: "82%" }}
          viewport={{ once: true }}
          transition={{ duration: reduceMotion ? 0 : 1.1, ease: EASE }}
        />
        <span className="absolute top-1/2 right-0 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-foreground" />
      </div>

      <div className="rounded-lg bg-primary/8 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {t("Next grade needed")}
        </p>
        <p className="numeric text-lg font-semibold text-primary">15.5</p>
      </div>
    </Frame>
  )
}

/** Which subject actually moved the average, and by how much. */
export function ImpactVisual() {
  const t = useExtracted()
  const rows = [
    { name: t("Maths"), impact: 0.42 },
    { name: t("English"), impact: 0.18 },
    { name: t("Physics"), impact: -0.26 },
    { name: t("History"), impact: -0.09 },
  ]
  const scale = 0.5

  return (
    <Frame className="flex flex-col justify-center gap-2.5">
      {rows.map((row, index) => {
        const positive = row.impact >= 0
        const width = `${Math.min(Math.abs(row.impact) / scale, 1) * 50}%`
        return (
          <div key={row.name} className="flex items-center gap-2">
            <span className="w-14 shrink-0 truncate text-[11px] text-muted-foreground">
              {row.name}
            </span>
            <span className="relative h-4 min-w-0 flex-1">
              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <motion.span
                className={cn(
                  "absolute inset-y-0.5 rounded-sm",
                  positive ? "left-1/2 bg-positive/70" : "right-1/2 bg-negative/70"
                )}
                initial={{ width: 0 }}
                whileInView={{ width }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.08, ease: EASE }}
              />
            </span>
            <span
              className={cn(
                "numeric w-11 shrink-0 text-right text-[11px] font-medium",
                positive ? "text-positive" : "text-negative"
              )}
            >
              {positive ? "+" : ""}
              {row.impact.toFixed(2)}
            </span>
          </div>
        )
      })}
    </Frame>
  )
}

/** A dashboard you arrange, rather than one you are given. */
export function DashboardVisual() {
  const reduceMotion = useReducedMotion()
  const [shuffled, setShuffled] = useState(false)

  useEffect(() => {
    if (reduceMotion) return
    const timer = window.setInterval(() => setShuffled((last) => !last), 2600)
    return () => window.clearInterval(timer)
  }, [reduceMotion])

  const tiles = shuffled
    ? ["col-span-2", "col-span-1", "col-span-1", "col-span-2"]
    : ["col-span-1", "col-span-2", "col-span-2", "col-span-1"]

  return (
    <Frame>
      <div className="grid h-full grid-cols-3 grid-rows-2 gap-2">
        {tiles.map((span, index) => (
          <motion.div
            key={index}
            layout
            transition={{ duration: reduceMotion ? 0 : 0.5, ease: EASE }}
            className={cn(
              "rounded-lg",
              span,
              index % 2 === 0 ? "bg-primary/12" : "bg-muted"
            )}
          />
        ))}
      </div>
    </Frame>
  )
}

/** Standing where you stood: the curve stops at the day you scrub to. */
export function TimeTravelVisual() {
  const t = useExtracted()
  const reduceMotion = useReducedMotion()

  return (
    <Frame className="flex flex-col justify-between gap-3">
      <div className="relative h-20">
        <svg viewBox="0 0 200 70" className="size-full" preserveAspectRatio="none">
          <path
            d="M0 52 C 26 48, 42 58, 62 44 S 104 22, 128 30 S 168 16, 200 12"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeOpacity="0.25"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          <motion.path
            d="M0 52 C 26 48, 42 58, 62 44 S 104 22, 128 30 S 168 16, 200 12"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={{ pathLength: 0.15 }}
            whileInView={{ pathLength: [0.15, 0.72, 0.42, 0.72] }}
            viewport={{ once: true }}
            transition={{
              duration: reduceMotion ? 0 : 5,
              times: [0, 0.4, 0.7, 1],
              ease: EASE,
            }}
          />
        </svg>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5">
        <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">
          {t("Viewing 14 March")}
        </span>
      </div>
    </Frame>
  )
}

/** The year, told back to you. */
export function RecapVisual() {
  const t = useExtracted()

  return (
    <Frame className="relative flex flex-col justify-center gap-2 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--primary)_14%,var(--card)),var(--card))] text-center">
      <SparklesIcon className="mx-auto size-5 text-primary" />
      <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        {t("Your year")}
      </p>
      <p className="text-lg leading-tight font-semibold tracking-tight">
        {t("The Steady Climber")}
      </p>
      <div className="mt-1 flex justify-center gap-4 text-[11px] text-muted-foreground">
        <span className="numeric">
          <ArrowUpRightIcon className="mr-0.5 inline size-3 text-positive" />
          +1.4
        </span>
        <span className="numeric">128 {t("grades")}</span>
      </div>
    </Frame>
  )
}

/** One engine, two screens — the same number, not a second calculation. */
export function EverywhereVisual() {
  return (
    <Frame className="flex items-end justify-center gap-3">
      <div className="flex-1 rounded-lg border bg-card p-2">
        <div className="h-1.5 w-8 rounded-full bg-muted" />
        <p className="numeric mt-2 text-xl font-semibold">14.12</p>
        <div className="mt-2 flex gap-1">
          <span className="h-1 flex-1 rounded-full bg-primary/50" />
          <span className="h-1 flex-1 rounded-full bg-muted" />
          <span className="h-1 flex-1 rounded-full bg-muted" />
        </div>
      </div>
      <div className="w-16 rounded-[0.9rem] border bg-card p-1.5 pb-3">
        <div className="mx-auto h-1 w-5 rounded-full bg-muted" />
        <p className="numeric mt-2 text-center text-sm font-semibold">14.12</p>
        <div className="mt-2 space-y-1">
          <span className="block h-1 rounded-full bg-primary/50" />
          <span className="block h-1 w-2/3 rounded-full bg-muted" />
        </div>
      </div>
    </Frame>
  )
}

/** Where the average is heading if nothing changes. */
export function ProjectionVisual() {
  const t = useExtracted()
  const reduceMotion = useReducedMotion()

  return (
    <Frame className="flex flex-col justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <span className="numeric text-2xl font-semibold">14.12</span>
        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-positive">
          <ArrowUpRightIcon className="size-3.5" />
          <span className="numeric">+0.38</span>
        </span>
      </div>
      <svg viewBox="0 0 200 60" className="h-16 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="landing-projection" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d="M0 46 C 30 42, 55 48, 80 36 S 130 26, 200 14 L 200 60 L 0 60 Z"
          fill="url(#landing-projection)"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: reduceMotion ? 0 : 0.8, delay: 0.3 }}
        />
        <motion.path
          d="M0 46 C 30 42, 55 48, 80 36 S 130 26, 200 14"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: reduceMotion ? 0 : 1.2, ease: EASE }}
        />
      </svg>
      <p className="text-[11px] text-muted-foreground">
        {t("On this pace, you finish the year here.")}
      </p>
    </Frame>
  )
}

/** Composite assessments: one mark made of several. */
export function CompositeVisual() {
  const t = useExtracted()
  const parts = [
    { label: t("Written"), value: "15", weight: "×3" },
    { label: t("Oral"), value: "12", weight: "×1" },
    { label: t("Practical"), value: "17", weight: "×2" },
  ]

  return (
    <Frame className="flex flex-col justify-center gap-2">
      {parts.map((part, index) => (
        <motion.div
          key={part.label}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: index * 0.08, ease: EASE }}
          className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
        >
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {part.label}
          </span>
          <span className="numeric rounded border border-dashed px-1 text-[10px] text-muted-foreground">
            {part.weight}
          </span>
          <span className="numeric font-medium">{part.value}</span>
        </motion.div>
      ))}
      <div className="mt-1 flex items-center gap-2 border-t pt-2 text-xs">
        <span className="min-w-0 flex-1 font-medium">{t("Assessment")}</span>
        <span className="numeric font-semibold">15.17</span>
      </div>
    </Frame>
  )
}

/** A subject slipping, caught before the report card does it. */
export function TrendVisual() {
  const t = useExtracted()
  const bars = [62, 68, 58, 71, 64, 49, 44]

  return (
    <Frame className="flex flex-col justify-end gap-3">
      <div className="flex h-20 items-end gap-1.5">
        {bars.map((height, index) => (
          <motion.span
            key={index}
            className={cn(
              "flex-1 rounded-t-sm",
              index >= bars.length - 2 ? "bg-negative/60" : "bg-primary/40"
            )}
            initial={{ height: 0 }}
            whileInView={{ height: `${height}%` }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.05, ease: EASE }}
          />
        ))}
      </div>
      <p className="inline-flex items-center gap-1 text-[11px] text-negative">
        <ArrowDownRightIcon className="size-3.5" />
        {t("Two results below your usual range")}
      </p>
    </Frame>
  )
}
