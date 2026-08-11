"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { AuthenticatedUser } from "@/lib/authenticated-user"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useBreadcrumbs } from "@/components/breadcrumb/use-breadcrumbs"
import { PAGE_ACTIONS_SLOT, usePageChrome } from "./page-chrome"
import { initialsOf } from "@/lib/name"

/**
 * The phone header.
 *
 * A large title that gives way to a compact bar as the page scrolls, so the
 * screen's name is unmistakable when you arrive and out of the way once you
 * are reading. The back arrow follows the hierarchy, not the history: landing
 * on a deep link should still walk you up rather than out of the app.
 */
export function MobileHeader({
  user,
  condensed,
}: {
  user: AuthenticatedUser
  condensed: boolean
}) {
  const t = useExtracted()
  const router = useRouter()
  const crumbs = useBreadcrumbs()
  const chrome = usePageChrome()

  const title = chrome.title ?? crumbs.at(-1)?.label ?? "Avermate"
  const parent = crumbs.length > 1 ? crumbs.at(-2) : undefined
  const backHref = chrome.backHref ?? parent?.href

  return (
    <header
      className={cn(
        "pt-safe z-30 shrink-0 transition-colors md:hidden",
        condensed &&
          "border-b border-border/70 bg-background/85 backdrop-blur-xl"
      )}
    >
      <div className="flex h-mobile-header items-center gap-1 px-2">
        {backHref ? (
          <button
            type="button"
            aria-label={t("Back")}
            onClick={() => {
              haptic("light")
              if (window.history.length > 1) router.back()
              else router.push(backHref)
            }}
            className="-ml-1 flex size-9 items-center justify-center rounded-full text-foreground transition-colors active:bg-accent"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
        ) : (
          <Link
            href="/settings"
            aria-label={t("Profile")}
            className="ml-1 flex size-9 items-center justify-center"
          >
            <Avatar className="size-8">
              <AvatarImage src={user.image ?? undefined} alt={user.name} />
              <AvatarFallback className="text-xs">
                {initialsOf(user.name)}
              </AvatarFallback>
            </Avatar>
          </Link>
        )}

        <span
          className={cn(
            "min-w-0 flex-1 truncate px-1 text-center text-[15px] font-semibold transition-opacity duration-200",
            condensed ? "opacity-100" : "opacity-0"
          )}
        >
          {title}
        </span>

        <div
          id={PAGE_ACTIONS_SLOT}
          className="flex min-w-9 items-center justify-end gap-1"
        />
      </div>
    </header>
  )
}

/**
 * The large phone title belongs to the scroll content, not to the fixed bar.
 *
 * Keeping it in normal flow means its height is consumed by `scrollTop` as it
 * leaves or re-enters the viewport. Expanding the fixed header near the top
 * used to move the whole scroll pane by that height, producing a visible
 * catch-up jump while the finger was still moving.
 */
export function MobilePageTitle() {
  const crumbs = useBreadcrumbs()
  const chrome = usePageChrome()
  const title = chrome.title ?? crumbs.at(-1)?.label ?? "Avermate"

  if (chrome.bare) return null

  return (
    <div className="pb-2 md:hidden">
      <h1 className="truncate text-[27px] leading-tight font-semibold tracking-tight">
        {title}
      </h1>
      {chrome.subtitle ? (
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {chrome.subtitle}
        </p>
      ) : null}
    </div>
  )
}
