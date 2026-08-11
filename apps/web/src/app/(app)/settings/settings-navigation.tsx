"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useExtracted } from "next-intl"
import { cn } from "@/lib/utils"

/** Only the active-route highlight needs the browser. */
export function SettingsNavigation() {
  const t = useExtracted()
  const pathname = usePathname()
  const sections = [
    { href: "/settings", label: t("Profile"), exact: true },
    { href: "/settings/appearance", label: t("Appearance") },
    { href: "/settings/year", label: t("Year & periods") },
    { href: "/settings/averages", label: t("Custom averages") },
    { href: "/settings/account", label: t("Account") },
    { href: "/settings/about", label: t("About") },
  ]

  return (
    <nav className="hidden w-52 shrink-0 md:block">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">
        {t("Settings")}
      </h1>
      <ul className="flex flex-col gap-0.5">
        {sections.map((section) => {
          const active = section.exact
            ? pathname === section.href
            : pathname.startsWith(section.href)
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                className={cn(
                  "block rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                {section.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
