import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowLeftIcon } from "lucide-react"
import { useExtracted } from "next-intl"

export default function LegalLayout({ children }: { children: ReactNode }) {
  const t = useExtracted()

  return (
    <div className="min-h-svh bg-background">
      <header className="pt-safe border-b">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))]">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            Avermate
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl pt-10 pr-[max(1rem,var(--spacing-safe-right))] pb-[max(2.5rem,var(--spacing-safe-bottom))] pl-[max(1rem,var(--spacing-safe-left))]">
        <article className="flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-foreground [&_li]:ml-4 [&_li]:list-disc">
          {children}
        </article>
        <nav
          aria-label={t("Legal information")}
          className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t pt-5 text-xs text-muted-foreground"
        >
          <Link href="/legal/privacy" className="hover:text-foreground">
            {t("Privacy policy")}
          </Link>
          <Link href="/legal/terms" className="hover:text-foreground">
            {t("Terms of service")}
          </Link>
          <Link href="/legal/social-sharing" className="hover:text-foreground">
            {t("Social sharing")}
          </Link>
        </nav>
      </main>
    </div>
  )
}
