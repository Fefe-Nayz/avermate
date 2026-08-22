"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentType } from "react"
import { cn } from "@/lib/utils"

/**
 * Moving between the screens of one area.
 *
 * Social, admin and planning are each several screens under one heading, and
 * each had invented its own way of switching between them: two rails that were
 * nearly the same, and one row of pills in a bordered card that looked like a
 * widget dropped on the page. Three shapes for one job is how an app stops
 * feeling like one app.
 *
 * So there is one shape, and it is the one that already worked: a rail beside
 * the content where there is room for it, and a scrolling row of pills above
 * the content where there is not. Same component, so the two cannot drift, and
 * same component across areas, so learning it once is enough.
 */

export interface SectionNavItem {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Matches this href alone rather than it and everything under it. */
  exact?: boolean
  /** Extra paths that should light this entry — a detail route, usually. */
  alsoMatches?: readonly string[]
}

export interface SectionNavGroup {
  /** Shown above the group in the rail; the pill row folds groups away. */
  label?: string
  items: readonly SectionNavItem[]
}

export function SectionNav({
  title,
  label,
  groups,
}: {
  /** The area's name, shown above the rail where the page has no other title. */
  title?: string
  /** What the navigation is called, for a screen reader. */
  label: string
  groups: readonly SectionNavGroup[]
}) {
  const pathname = usePathname()
  // One flat, ordered list for the phone row. A row that scrolls sideways has
  // no room for headings, and "Social · Overview" beside the top-level
  // "Overview" would otherwise be two identical pills.
  const items = groups.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      pillLabel: group.label ? `${group.label} · ${item.label}` : item.label,
    }))
  )

  const isActive = (item: SectionNavItem) => {
    if (item.alsoMatches?.some((prefix) => pathname.startsWith(prefix))) {
      return true
    }
    return item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  return (
    <>
      <nav aria-label={label} className="hidden w-52 shrink-0 md:block">
        {title ? (
          <h1 className="mb-3 text-2xl font-semibold tracking-tight">
            {title}
          </h1>
        ) : null}
        <div className="flex flex-col gap-4">
          {groups.map((group, index) => (
            <div key={group.label ?? index}>
              {group.label ? (
                <p className="mb-1 px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
              ) : null}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(item)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md border border-transparent px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          active
                            ? "border-primary/20 bg-primary font-medium text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <item.icon className="size-4 shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* A row that scrolls sideways has no room for headings, so the groups
          are flattened here — the labels they carried belong in the item names
          when a group is worth naming at all. */}
      <nav
        aria-label={label}
        className="-mx-1 no-scrollbar overflow-x-auto px-1 pb-1 md:hidden"
      >
        <ul className="flex min-w-max gap-1 rounded-xl border bg-card p-1">
          {items.map((item) => {
            const active = isActive(item)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted"
                  )}
                >
                  <item.icon className="size-4" />
                  {item.pillLabel}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
