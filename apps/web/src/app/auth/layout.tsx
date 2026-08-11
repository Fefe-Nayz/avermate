import Link from "next/link"
import type { ReactNode } from "react"
import {
  CheckIcon,
  GraduationCapIcon,
  LockKeyholeIcon,
  TargetIcon,
  TrendingUpIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle"

/**
 * The way into the app.
 *
 * The panel used to be painted with hard-coded hexes — a near-black
 * background, indigo and cyan glows, emerald badges — so whichever palette the
 * account had chosen, the first screen was somebody else's blue. It is drawn
 * from the same tokens as everything behind the sign-in now, which is the
 * whole point of having tokens.
 *
 * The illustration is deliberately marked as one. A fabricated average
 * rendered in the app's own type, at the size the real dashboard uses, invites
 * being read as data; a small labelled sample does not.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useExtracted()

  const bars = [30, 38, 34, 47, 44, 56, 62, 58, 69, 76, 82, 88]

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(27rem,.95fr)]">
      <aside className="relative hidden overflow-hidden border-r bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col xl:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.14] [background:radial-gradient(circle_at_12%_8%,var(--primary),transparent_38%),radial-gradient(circle_at_88%_86%,var(--chart-2),transparent_42%)]"
        />

        <Link
          href="/"
          className="relative flex items-center gap-2.5 font-semibold tracking-tight"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCapIcon className="size-5" />
          </span>
          Avermate
        </Link>

        <div className="relative my-auto max-w-xl py-14">
          <p className="text-xs font-semibold tracking-[0.24em] text-primary uppercase">
            {t("Your school year, made clear")}
          </p>
          <h2 className="mt-5 text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance xl:text-5xl">
            {t("Every grade has an impact. See it before the next one.")}
          </h2>
          <p className="mt-5 max-w-lg leading-relaxed text-muted-foreground">
            {t(
              "Avermate follows your coefficients, explains your progress and turns a target into the results it would take."
            )}
          </p>

          <figure className="mt-10 grid max-w-xl grid-cols-2 gap-3">
            <figcaption className="col-span-2 text-[11px] tracking-wide text-muted-foreground uppercase">
              {t("A sample year")}
            </figcaption>

            <div className="col-span-2 rounded-2xl border bg-card/70 p-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("General average")}
                  </p>
                  <p className="numeric mt-1.5 text-3xl font-semibold tracking-tight">
                    15.84
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-positive/12 px-2.5 py-1 text-xs text-positive">
                  <TrendingUpIcon className="size-3" /> +0.42
                </span>
              </div>
              <div className="mt-6 flex h-20 items-end gap-1" aria-hidden>
                {bars.map((height, index) => (
                  <span
                    key={`${height}-${index}`}
                    className="flex-1 rounded-t bg-gradient-to-t from-primary/15 to-primary/80"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border bg-card/70 p-4 backdrop-blur">
              <TargetIcon className="size-4 text-primary" />
              <p className="mt-4 text-xs text-muted-foreground">
                {t("Next target")}
              </p>
              <p className="numeric mt-1 text-2xl font-semibold">16.5</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("A plan, not a guess")}
              </p>
            </div>

            <div className="rounded-2xl border bg-card/70 p-4 backdrop-blur">
              <TrendingUpIcon className="size-4 text-primary" />
              <p className="mt-4 text-xs text-muted-foreground">{t("Trend")}</p>
              <p className="mt-1 text-lg font-semibold">{t("Climbing")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Explained grade by grade")}
              </p>
            </div>
          </figure>
        </div>

        <div className="relative flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-3.5" /> {t("Free to use")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <LockKeyholeIcon className="size-3.5" />{" "}
            {t("Your data stays yours")}
          </span>
        </div>
      </aside>

      <div className="flex min-h-svh flex-col">
        <header className="pt-safe flex h-[calc(4rem+env(safe-area-inset-top))] items-center px-4 sm:px-7">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold lg:hidden"
          >
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <GraduationCapIcon className="size-4" />
            </span>
            Avermate
          </Link>
          <div className="ml-auto">
            <PublicThemeToggle />
          </div>
        </header>

        <main className="flex flex-1 items-start justify-center px-4 pt-2 pb-12 sm:px-7 md:items-center md:pt-0">
          {/*
           * No card below `sm`. A bordered panel inset from a phone's edge
           * wastes the only axis that matters there and boxes the form twice —
           * once by the screen, once by the border.
           */}
          <div className="w-full max-w-md sm:rounded-2xl sm:border sm:bg-card sm:p-8 sm:shadow-[0_24px_80px_-44px_rgba(0,0,0,.5)]">
            {children}
          </div>
        </main>

        <footer className="pb-safe flex items-center justify-center gap-1.5 px-4 pb-5 text-center text-xs text-muted-foreground">
          <LockKeyholeIcon className="size-3" />
          {t("Secure sign-in. Your school data is never public.")}
        </footer>
      </div>
    </div>
  )
}
