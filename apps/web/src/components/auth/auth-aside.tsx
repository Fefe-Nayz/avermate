"use client"

import { CheckIcon, TargetIcon, TrendingUpIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { MagicCard } from "@/components/ui/magic-card"

/**
 * The half of the auth card that is not the form.
 *
 * Hidden below `md`, where the form is the only thing worth the width. The
 * sample is labelled as a sample: a fabricated average set in the app's own
 * type, at the size the real dashboard uses, invites being read as data.
 */
export function AuthAside() {
  const t = useExtracted()

  const bars = [30, 38, 34, 47, 44, 56, 62, 58, 69, 76, 82, 88]
  const promises = [
    t("Your school's real coefficients"),
    t("Every grade's impact, explained"),
    t("A target turned into a plan"),
  ]

  return (
    <aside className="relative hidden flex-col justify-center gap-6 border-l bg-sidebar p-8 md:flex">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14] [background:radial-gradient(circle_at_70%_18%,var(--primary),transparent_55%)]"
      />

      <div className="relative">
        <p className="font-mono text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
          {t("Your school year, made clear")}
        </p>
        <h2 className="mt-3 text-2xl leading-tight font-semibold tracking-tight text-balance">
          {t("Every grade has an impact. See it before the next one.")}
        </h2>
      </div>

      <figure className="relative flex flex-col gap-3">
        <figcaption className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          {t("A sample year")}
        </figcaption>

        <MagicCard
          gradientFrom="var(--primary)"
          gradientTo="var(--chart-2)"
          gradientSize={180}
          gradientOpacity={0.1}
          className="rounded-xl"
          plateClassName="bg-card"
        >
          <div className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("General average")}
                </p>
                <p className="numeric mt-1 text-2xl font-semibold tracking-tight">
                  15.84
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-positive/12 px-2 py-0.5 text-xs text-positive">
                <TrendingUpIcon className="size-3" />
                <span className="numeric">+0.42</span>
              </span>
            </div>
            <div className="mt-4 flex h-14 items-end gap-1" aria-hidden>
              {bars.map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  className="flex-1 rounded-t bg-gradient-to-t from-primary/15 to-primary/80"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
        </MagicCard>

        <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3">
          <TargetIcon className="size-4 shrink-0 text-primary" />
          <p className="text-sm">
            {t("Next target")}{" "}
            <span className="numeric font-semibold">16.5</span>
          </p>
          <p className="ml-auto text-xs text-muted-foreground">
            {t("A plan, not a guess")}
          </p>
        </div>
      </figure>

      <ul className="relative flex flex-col gap-2">
        {promises.map((promise) => (
          <li
            key={promise}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <CheckIcon className="size-3.5 shrink-0 text-positive" />
            {promise}
          </li>
        ))}
      </ul>
    </aside>
  )
}
