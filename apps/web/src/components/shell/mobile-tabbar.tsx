"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookMarkedIcon,
  EllipsisIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  PlusIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useQuickAdd } from "./quick-add"

/**
 * The bottom bar.
 *
 * Four destinations and one action, which is as many targets as a thumb can
 * reach without looking. The action sits in the middle and is raised, because
 * "record a grade" is the thing this app is opened to do and it should not
 * take a scroll to reach.
 */
export function MobileTabBar() {
  const t = useExtracted()
  const pathname = usePathname()
  const quickAdd = useQuickAdd()

  const tabs = [
    { href: "/dashboard", label: t("Home"), icon: LayoutDashboardIcon },
    { href: "/subjects", label: t("Subjects"), icon: BookMarkedIcon },
    null,
    { href: "/grades", label: t("Grades"), icon: ListChecksIcon },
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

          return (
            <li key={tab.href} className="flex justify-center">
              <Link
                href={tab.href}
                onClick={() => haptic("selection")}
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
