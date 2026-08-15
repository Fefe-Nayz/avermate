"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useExtracted } from "next-intl"
import {
  FlagIcon,
  LayersIcon,
  LayoutGridIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Where you are in administration.
 *
 * The section had no navigation at all: every page arrived through a link
 * somewhere else and offered no way across to its siblings, so moving from
 * users to feedback meant going back to the index each time. Social is the
 * worst of it — four pages deep with nothing tying them together — so it is
 * grouped rather than flattened into a list of eight peers.
 *
 * Same rail as settings, for the same reason: on a phone these are ordinary
 * pages reached and left with the back arrow, not a nested navigator inside a
 * scroll container.
 */
export function AdminNavigation() {
  const t = useExtracted()
  const pathname = usePathname()

  const groups = [
    {
      label: null,
      items: [
        {
          href: "/admin",
          label: t("Overview"),
          icon: LayersIcon,
          exact: true,
        },
        { href: "/admin/users", label: t("Users"), icon: UsersIcon },
        {
          href: "/admin/feedback",
          label: t("Feedback"),
          icon: MessageSquareIcon,
        },
        {
          href: "/admin/announcements",
          label: t("Announcements"),
          icon: MegaphoneIcon,
        },
        {
          href: "/admin/presets",
          label: t("Curriculum presets"),
          icon: ScrollTextIcon,
        },
        {
          href: "/admin/card-templates",
          label: t("Card gallery"),
          icon: LayoutGridIcon,
        },
      ],
    },
    {
      label: t("Social"),
      items: [
        {
          href: "/admin/social",
          label: t("Overview"),
          icon: ShieldIcon,
          exact: true,
        },
        {
          href: "/admin/social/reports",
          label: t("Reports"),
          icon: FlagIcon,
        },
        {
          href: "/admin/social/groups",
          label: t("Classes"),
          icon: UsersRoundIcon,
        },
      ],
    },
  ]

  return (
    <nav className="hidden w-56 shrink-0 md:block">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">
        {t("Administration")}
      </h1>
      <div className="flex flex-col gap-4">
        {groups.map((group, index) => (
          <div key={group.label ?? index} className="flex flex-col gap-0.5">
            {group.label ? (
              <p className="mb-1 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => {
              const active =
                "exact" in item && item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
