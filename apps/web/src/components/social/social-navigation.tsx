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

  return (
    <nav
      aria-label={t("Social sections")}
      className="-mx-1 overflow-x-auto px-1 pb-1"
    >
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
  )
}
