"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BellIcon,
  ContactRoundIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { useSocialAccess } from "@/hooks/use-social-access"
import { cn } from "@/lib/utils"

/**
 * Where you are in social.
 *
 * A rail on a wide screen and a scrolling row of pills on a phone — the same
 * arrangement settings and administration use, because these are the same kind
 * of thing. The section used to show the pill row at every width, which on a
 * desktop pinned five destinations into a strip across the top and left the
 * width beside it empty.
 */
export function SocialNavigation() {
  const pathname = usePathname()
  const t = useExtracted()
  const { canAccessFriends } = useSocialAccess()

  const items = [
    {
      href: "/social",
      label: t("Overview"),
      icon: ContactRoundIcon,
      exact: true,
    },
    ...(canAccessFriends
      ? [{ href: "/social/friends", label: t("Friends"), icon: UserRoundIcon }]
      : []),
    { href: "/social/groups", label: t("Groups"), icon: UsersRoundIcon },
    ...(canAccessFriends
      ? [
          {
            href: "/social/profile",
            label: t("Sharing"),
            icon: ShieldCheckIcon,
          },
        ]
      : []),
    { href: "/social/notifications", label: t("Updates"), icon: BellIcon },
  ]

  const isActive = (item: (typeof items)[number]) =>
    "exact" in item && item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`)

  return (
    <>
      <nav
        aria-label={t("Social sections")}
        className="hidden w-52 shrink-0 md:block"
      >
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">
          {t("Social")}
        </h1>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = isActive(item)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
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
        aria-label={t("Social sections")}
        className="-mx-1 overflow-x-auto px-1 pb-1 md:hidden"
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
    </>
  )
}
