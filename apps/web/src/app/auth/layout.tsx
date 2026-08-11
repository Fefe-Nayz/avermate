import Link from "next/link"
import type { ReactNode } from "react"
import { GraduationCapIcon, LockKeyholeIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { AuthAside } from "@/components/auth/auth-aside"
import { Card, CardContent } from "@/components/ui/card"
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle"

/**
 * The way into the app.
 *
 * A centred card rather than a full-bleed split. The split gave half the
 * screen to a panel painted with hard-coded hexes — a near-black background,
 * indigo and cyan glows — so whichever palette the account had chosen, the
 * first screen was somebody else's blue, and the form itself was pushed into a
 * column at the edge. Here the illustration sits *inside* the card, beside the
 * form, and everything is drawn from the app's own tokens.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useExtracted()

  return (
    <div className="relative flex min-h-svh flex-col bg-muted">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background:radial-gradient(circle_at_18%_12%,var(--primary),transparent_42%),radial-gradient(circle_at_84%_88%,var(--chart-2),transparent_46%)]"
      />

      <header className="pt-safe relative flex h-16 items-center px-4 sm:px-6">
        <div className="ml-auto">
          <PublicThemeToggle />
        </div>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 pb-10 sm:px-6">
        <div className="flex w-full max-w-sm flex-col gap-5 md:max-w-4xl">
          <Link
            href="/"
            className="flex items-center gap-2 self-center rounded-md p-2 font-semibold tracking-tight transition-colors hover:bg-accent"
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GraduationCapIcon className="size-4" />
            </span>
            Avermate
          </Link>

          <Card className="overflow-hidden p-0">
            <CardContent className="grid p-0 md:grid-cols-2">
              <div className="p-6 sm:p-8">{children}</div>
              <AuthAside />
            </CardContent>
          </Card>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <LockKeyholeIcon className="size-3 shrink-0" />
            {t("Secure sign-in. Your school data is never public.")}
          </p>
        </div>
      </main>
    </div>
  )
}
