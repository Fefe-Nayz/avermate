import Link from "next/link"
import type { ReactNode } from "react"
import {
  ArrowUpRightIcon,
  ChartNoAxesCombinedIcon,
  CheckIcon,
  GraduationCapIcon,
  LockKeyholeIcon,
  TargetIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle"

export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useExtracted()

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.08fr)_minmax(28rem,.92fr)]">
      <aside className="relative hidden overflow-hidden border-r bg-[#080b16] p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(99,102,241,.48),transparent_34%),radial-gradient(circle_at_90%_82%,rgba(14,165,233,.3),transparent_38%)]" />
        <Link
          href="/"
          className="relative flex items-center gap-2.5 font-semibold tracking-tight"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-white text-[#080b16]">
            <GraduationCapIcon className="size-5" />
          </span>
          Avermate
        </Link>

        <div className="relative my-auto max-w-xl py-14">
          <p className="text-xs font-semibold tracking-[0.24em] text-indigo-200 uppercase">
            {t("Your school year, made clear")}
          </p>
          <h2 className="mt-5 text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance xl:text-5xl">
            {t("Every grade has an impact. See it before the next one.")}
          </h2>
          <p className="mt-5 max-w-lg leading-relaxed text-white/58">
            {t(
              "Avermate follows your coefficients, explains your progress and turns a target into the results it would take."
            )}
          </p>

          <div className="mt-10 grid max-w-xl grid-cols-2 gap-3">
            <div className="col-span-2 rounded-2xl border border-white/10 bg-white/8 p-5 shadow-2xl backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-white/48">
                    {t("General average")}
                  </p>
                  <p className="numeric mt-2 text-4xl font-semibold tracking-tight">
                    15.84
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-300/12 px-2.5 py-1 text-xs text-emerald-200">
                  <ArrowUpRightIcon className="size-3" /> +0.42
                </span>
              </div>
              <div
                className="mt-6 flex h-20 items-end gap-1"
                aria-hidden="true"
              >
                {[30, 38, 34, 47, 44, 56, 62, 58, 69, 76, 82, 88].map(
                  (height, index) => (
                    <span
                      key={`${height}-${index}`}
                      className="flex-1 rounded-t bg-gradient-to-t from-indigo-400/20 to-indigo-300/85"
                      style={{ height: `${height}%` }}
                    />
                  )
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 p-4 backdrop-blur">
              <TargetIcon className="size-4 text-indigo-200" />
              <p className="mt-4 text-xs text-white/45">{t("Next target")}</p>
              <p className="numeric mt-1 text-2xl font-semibold">16.5</p>
              <p className="mt-1 text-xs text-white/45">
                {t("A plan, not a guess")}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 p-4 backdrop-blur">
              <ChartNoAxesCombinedIcon className="size-4 text-cyan-200" />
              <p className="mt-4 text-xs text-white/45">{t("Trend")}</p>
              <p className="mt-1 text-lg font-semibold">{t("Climbing")}</p>
              <p className="mt-1 text-xs text-white/45">
                {t("Explained grade by grade")}
              </p>
            </div>
          </div>
        </div>

        <div className="relative flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/48">
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

        <main className="flex flex-1 items-start justify-center px-4 pt-5 pb-12 sm:px-7 md:items-center md:pt-0">
          <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-[0_24px_80px_-44px_rgba(0,0,0,.5)] sm:p-8">
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
