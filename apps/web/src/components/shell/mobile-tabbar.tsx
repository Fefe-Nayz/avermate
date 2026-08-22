"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { EllipsisIcon, PlusIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { usePreferences } from "@/hooks/use-preferences"
import {
  DEFAULT_TAB_HREFS,
  NAV_ENTRIES,
  sanitizeNavSelection,
  TAB_SLOT_COUNT,
} from "@/lib/nav"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useQuickAdd } from "./quick-add"
import { useScrollPane } from "./scroll-pane"

/**
 * The bottom bar.
 *
 * Four destinations and one action, which is as many targets as a thumb can
 * reach without looking. The action sits in the middle and is raised, because
 * "record a grade" is the thing this app is opened to do and it should not
 * take a scroll to reach. Three of the destinations are the account's own
 * picks (Settings → Navigation); "More" keeps the last seat so every other
 * screen stays one tap away.
 */
export function MobileTabBar() {
  const t = useExtracted()
  const pathname = usePathname()
  const router = useRouter()
  const pane = useScrollPane()
  const quickAdd = useQuickAdd()
  const { preferences } = usePreferences()

  const labels: Record<string, string> = {
    Dashboard: t("Home"),
    Subjects: t("Subjects"),
    Grades: t("Grades"),
    Materials: t("Materials"),
    Learning: t("Learning"),
    "Study projects": t("Study projects"),
    Assistant: t("Assistant"),
    Goals: t("Goals"),
    Planning: t("Planning"),
    Insights: t("Insights"),
    Social: t("Social"),
  }

  const chosen = sanitizeNavSelection(
    preferences.navigation.tabs,
    DEFAULT_TAB_HREFS,
    TAB_SLOT_COUNT
  ).flatMap((href) => {
    const entry = NAV_ENTRIES.find((candidate) => candidate.href === href)
    return entry
      ? [{ href, label: labels[entry.label] ?? entry.label, icon: entry.icon }]
      : []
  })

  const tabs = [
    chosen[0] ?? null,
    chosen[1] ?? null,
    null,
    chosen[2] ?? null,
    { href: "/more", label: t("More"), icon: EllipsisIcon },
  ] as const

  return (
    <nav
      aria-label={t("Main")}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/85 backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid h-tabbar max-w-lg grid-cols-5 items-center pr-[var(--spacing-safe-right)] pl-[var(--spacing-safe-left)]">
        {tabs.map((tab) => {
          if (!tab) {
            return (
              <li key="action" className="flex justify-center">
                <button
                  type="button"
                  aria-label={t("Add")}
                  onClick={() => {
                    haptic("medium")
                    quickAdd.open()
                  }}
                  className="-mt-6 flex size-13 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 shadow-primary/25 ring-background transition-transform active:scale-92"
                >
                  <PlusIcon className="size-6" />
                </button>
              </li>
            )
          }

          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          // Only the exact route re-taps. From `/grades/abc` the Grades tab is
          // lit but tapping it means "up to the list", so the link must run.
          const onCurrentScreen = pathname === tab.href

          return (
            <li key={tab.href} className="flex justify-center">
              <Link
                href={tab.href}
                onClick={(event) => {
                  haptic("selection")
                  if (!onCurrentScreen) return
                  // Nowhere to navigate: the tap becomes the two things a phone
                  // means by tapping the tab you are already on — first take me
                  // back to the top, then, once there, get me fresh data.
                  event.preventDefault()
                  if (pane && !pane.isAtTop()) {
                    pane.scrollToTop()
                    return
                  }
                  // Through the pane, not the router: a bare refresh replaces
                  // the tree with no spinner at all, and a tap that shows
                  // nothing is indistinguishable from a tap that did nothing.
                  if (pane) pane.refresh()
                  else router.refresh()
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground"
                )}
              >
                <tab.icon
                  className={cn("size-5.5", active && "fill-primary/12")}
                  strokeWidth={active ? 2.2 : 1.8}
                />
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
