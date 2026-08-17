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
 * A rail on a wide screen and a scrolling row of pills on a phone — the same
 * shape social uses, from one component so the two cannot drift apart. The
 * rail alone left every one of these nine pages unreachable below `md`: the
 * back arrow only retraces the way in, so a phone could not cross from users
 * to feedback at all.
 *
 * The pills flatten the groups. A row that scrolls sideways has no room for
 * headings, and "Social › Overview" beside the top-level "Overview" would be
 * two identical pills, so the grouped labels are folded into the item names.
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

  const isActive = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  /** One flat, ordered list for the phone row; group labels become prefixes. */
  const pills = groups.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      label: group.label ? `${group.label} · ${item.label}` : item.label,
    }))
  )

  return (
    <>
      <nav
        aria-label={t("Administration sections")}
        className="-mx-1 no-scrollbar overflow-x-auto px-1 pb-1 md:hidden"
      >
        <ul className="flex min-w-max gap-1 rounded-xl border bg-card p-1">
          {pills.map((item) => {
            const active = isActive(item)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted"
                  )}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <nav
        aria-label={t("Administration sections")}
        className="hidden w-56 shrink-0 md:block"
      >
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
                const active = isActive(item)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
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
    </>
  )
}
