"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useExtracted } from "next-intl"
import { isActiveSettingsSection } from "@/lib/nav"
import { useSettingsSections } from "@/lib/nav-labels"
import { cn } from "@/lib/utils"

/**
 * Only the active-route highlight needs the browser.
 *
 * The icons are not decoration: nine near-identical text rows are read one by
 * one, where a shape is recognised at a glance, and the same glyph appears on
 * the section's own heading so the rail and the page agree.
 */
export function SettingsNavigation() {
  const t = useExtracted()
  const pathname = usePathname()

  // Shared with the account hub, which is the only way onto these screens on a
  // phone — this rail is `hidden md:block`.
  const sections = useSettingsSections()

  return (
    <nav className="hidden w-52 shrink-0 md:block">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">
        {t("Settings")}
      </h1>
      <ul className="flex flex-col gap-0.5">
        {sections.map((section) => {
          const active = isActiveSettingsSection(pathname, section)
          const Icon = section.icon
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                {section.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
