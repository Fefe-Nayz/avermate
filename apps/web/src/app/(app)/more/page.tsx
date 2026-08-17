"use client"

import Link from "next/link"
import { useThemeControl } from "@/hooks/use-preferences"
import { useRouter } from "next/navigation"
import {
  ChartNoAxesCombinedIcon,
  BellIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  MoonIcon,
  ShieldIcon,
  SparklesIcon,
  SunIcon,
  TargetIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { PageMeta } from "@/components/shell/page-chrome"
import { useFeedback } from "@/components/feedback/feedback-provider"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { initialsOf } from "@/lib/name"
import { signOut } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { useIsAdmin } from "@/hooks/use-admin"
import { useYear } from "@/components/year/year-provider"
import { useYearSheet } from "@/components/shell/year-sheet"
import { useSettingsSections } from "@/lib/nav-labels"

/**
 * The account hub.
 *
 * On a phone this is the fifth tab: everything the tab bar has no room for,
 * as one scrollable list of rows, the pattern every phone user already knows
 * from their settings app. It used to be *only* that, so a desktop visitor got
 * a column of full-width rows stretched across a monitor. The same rows now
 * settle into a bounded two-column hub above `md`.
 */
export default function MorePage() {
  const t = useExtracted()
  const router = useRouter()
  const user = useAuthenticatedUser()
  const { resolvedTheme, setPreferredTheme } = useThemeControl()
  const feedback = useFeedback()

  const { isAdmin } = useIsAdmin()
  const { year, years } = useYear()
  const yearSheet = useYearSheet()
  const settings = useSettingsSections()

  const groups: Array<{
    label?: string
    items: Array<{
      icon: LucideIcon
      label: string
      href?: string
      onClick?: () => void
      destructive?: boolean
    }>
  }> = [
    {
      items: [
        ...(years.length > 1
          ? [
              {
                icon: GraduationCapIcon,
                label: `${t("School year")} · ${year?.name ?? ""}`,
                onClick: () => yearSheet.open(),
              },
            ]
          : []),
        { icon: TargetIcon, label: t("Goals"), href: "/goals" },
        { icon: UsersRoundIcon, label: t("Social"), href: "/social" },
        {
          icon: ChartNoAxesCombinedIcon,
          label: t("Insights"),
          href: "/insights",
        },
        { icon: SparklesIcon, label: t("Year in review"), href: "/review" },
        { icon: BellIcon, label: t("Announcements"), href: "/announcements" },
      ],
    },
    {
      label: t("Settings"),
      // Every section, not a chosen few. The desktop rail is `hidden md:block`,
      // so a section missing from this list is a section a phone cannot reach —
      // which is what had happened to Navigation, Year preset, Custom averages,
      // Account and Integrations.
      items: settings.map((section) => ({
        icon: section.icon,
        label: section.label,
        href: section.href,
      })),
    },
    {
      items: [
        {
          icon: MessageSquarePlusIcon,
          label: t("Send feedback"),
          onClick: () => feedback.open(),
        },
        ...(isAdmin
          ? [{ icon: ShieldIcon, label: t("Admin"), href: "/admin" }]
          : []),
      ],
    },
    {
      items: [
        {
          icon: LogOutIcon,
          label: t("Sign out"),
          destructive: true,
          onClick: async () => {
            haptic("light")
            await signOut()
            router.replace("/auth/sign-in")
          },
        },
      ],
    },
  ]

  return (
    <>
      <PageMeta title={t("More")} />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div className="hidden md:block">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Account")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Everything about you and this app, in one place.")}
          </p>
        </div>

        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/60 active:bg-accent"
        >
          <Avatar className="size-12">
            <AvatarImage src={user.image ?? undefined} alt={user.name} />
            <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>
          <ChevronRightIcon className="size-4 text-muted-foreground/60" />
        </Link>

        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex min-h-13 items-center gap-3 px-4 py-2.5">
            {resolvedTheme === "dark" ? (
              <MoonIcon className="size-4.5 text-muted-foreground" />
            ) : (
              <SunIcon className="size-4.5 text-muted-foreground" />
            )}
            <span className="flex-1 text-sm">{t("Dark mode")}</span>
            <Switch
              checked={resolvedTheme === "dark"}
              onCheckedChange={(checked) => {
                haptic("selection")
                setPreferredTheme(checked ? "dark" : "light")
              }}
            />
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2 md:items-start">
          {groups.map((group, groupIndex) => (
            <section key={groupIndex} className="flex flex-col gap-1.5">
              {group.label ? (
                <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </h2>
              ) : null}
              <div className="overflow-hidden rounded-xl border bg-card">
                {group.items.map((item, index) => {
                  const content = (
                    <>
                      <item.icon
                        className={
                          item.destructive
                            ? "size-4.5 text-destructive"
                            : "size-4.5 text-muted-foreground"
                        }
                      />
                      <span
                        className={
                          item.destructive
                            ? "flex-1 text-sm text-destructive"
                            : "flex-1 text-sm"
                        }
                      >
                        {item.label}
                      </span>
                      {item.href ? (
                        <ChevronRightIcon className="size-4 text-muted-foreground/60" />
                      ) : null}
                    </>
                  )

                  const className = `flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/60 active:bg-accent ${
                    index > 0 ? "border-t" : ""
                  }`

                  return item.href ? (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={className}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.onClick}
                      className={className}
                    >
                      {content}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Avermate · {t("Made for students")}
        </p>
      </div>
    </>
  )
}
