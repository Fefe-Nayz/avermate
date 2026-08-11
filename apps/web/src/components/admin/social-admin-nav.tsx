"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  FileClockIcon,
  FlagIcon,
  LayoutDashboardIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { cn } from "@/lib/utils"

export function SocialAdminNav() {
  const pathname = usePathname()
  const t = useExtracted()
  const items = [
    {
      href: "/admin/social",
      label: t("Overview"),
      icon: LayoutDashboardIcon,
      exact: true,
    },
    {
      href: "/admin/social/groups",
      label: t("Groups"),
      icon: UsersRoundIcon,
    },
    {
      href: "/admin/social/reports",
      label: t("Reports"),
      icon: FlagIcon,
    },
    {
      href: "/admin/social/audit",
      label: t("Audit trail"),
      icon: FileClockIcon,
    },
  ]

  return (
    <nav aria-label={t("Social administration")} className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 rounded-xl border bg-card p-1">
        {items.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
