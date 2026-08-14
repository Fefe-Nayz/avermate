"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { GraduationCapIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SECTIONS = ["why", "features", "how", "faq"] as const

/**
 * The landing header.
 *
 * It knows where you are: the anchor for the section under the fold is marked
 * as current, which is the only thing a four-link nav on a one-page site can
 * usefully do. It also thins its border once you leave the hero, so the header
 * stops looking like a box drawn over the artwork.
 */
export function LandingHeader() {
  const t = useExtracted()
  const [active, setActive] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const targets = SECTIONS.map((id) => document.getElementById(id)).filter(
      (element): element is HTMLElement => element !== null
    )
    if (targets.length === 0) return

    // Bias the viewport to its upper third so a section counts as "current"
    // once its heading is comfortably read, not when its last pixel scrolls in.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: "-20% 0px -70% 0px" }
    )
    for (const target of targets) observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const links = [
    { href: "#why", id: "why", label: t("Why Avermate") },
    { href: "#features", id: "features", label: t("Features") },
    { href: "#how", id: "how", label: t("How it works") },
    { href: "#faq", id: "faq", label: t("FAQ") },
  ]

  return (
    <header
      className={cn(
        "pt-safe sticky top-0 z-40 transition-colors duration-300",
        scrolled
          ? "border-b border-border/60 bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))]">
        <Link
          href="/"
          aria-label={t("Avermate home")}
          className="flex items-center gap-2.5 font-semibold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <GraduationCapIcon className="size-4.5" />
          </span>
          Avermate
        </Link>

        <nav
          aria-label={t("Landing page")}
          className="ml-8 hidden items-center gap-1 lg:flex"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={active === link.id ? "true" : undefined}
              className={cn(
                "rounded-lg px-3 py-2 text-sm transition-colors",
                active === link.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <PublicThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            render={<Link href="/auth/sign-in" />}
          >
            {t("Sign in")}
          </Button>
          <Button size="sm" render={<Link href="/auth/sign-up" />}>
            <span className="hidden sm:inline">{t("Get started")}</span>
            <span className="sm:hidden">{t("Join")}</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
