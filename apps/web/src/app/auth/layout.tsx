import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowLeftIcon, GraduationCapIcon, LockKeyholeIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { AuthAside } from "@/components/auth/auth-aside"
import { AuthBackdrop, AuthCard } from "@/components/auth/auth-frame"
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle"

/**
 * The way into the app.
 *
 * A centred card rather than a full-bleed split. The split gave half the
 * screen to a panel painted with hard-coded hexes — a near-black background,
 * indigo and cyan glows — so whichever palette the account had chosen, the
 * first screen was somebody else's blue, and the form itself was pushed into a
 * column at the edge.
 *
 * The card now sits on the same rays and dot field the landing page uses, with
 * a light tracing its border: someone arriving from the marketing site should
 * recognise where they are rather than feel handed to a different product.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useExtracted()

  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <AuthBackdrop />

      <header className="pt-safe relative z-10 flex h-[calc(4rem+var(--spacing-safe-top))] items-center gap-2 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))]">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          <span className="hidden sm:inline">{t("Back to Avermate")}</span>
        </Link>
        <div className="ml-auto">
          <PublicThemeToggle />
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center pr-[max(1rem,var(--spacing-safe-right))] pb-[max(3rem,var(--spacing-safe-bottom))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))]">
        <div className="flex w-full max-w-sm flex-col gap-5 md:max-w-4xl">
          <Link
            href="/"
            className="flex items-center gap-2.5 self-center rounded-lg p-2 font-semibold tracking-tight transition-colors hover:bg-accent"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <GraduationCapIcon className="size-4" />
            </span>
            Avermate
          </Link>

          <AuthCard>
            <div className="p-6 sm:p-8">{children}</div>
            <AuthAside />
          </AuthCard>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <LockKeyholeIcon className="size-3 shrink-0" />
            {t("Secure sign-in. Your school data is never public.")}
          </p>
        </div>
      </main>
    </div>
  )
}
