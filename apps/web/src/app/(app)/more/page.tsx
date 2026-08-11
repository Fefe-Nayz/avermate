"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChartNoAxesCombinedIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  InfoIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  MoonIcon,
  PaletteIcon,
  ShieldIcon,
  SparklesIcon,
  SunIcon,
  TargetIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useExtracted } from "next-intl"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { PageMeta } from "@/components/shell/page-chrome"
import { useFeedback } from "@/components/feedback/feedback-provider"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { initialsOf } from "@/components/shell/nav-user"
import { signOut } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { useIsAdmin } from "@/hooks/use-admin"
import { useYear } from "@/components/year/year-provider"
import { useYearSheet } from "@/components/shell/year-sheet"

/**
 * The phone's fifth tab.
 *
 * Everything the tab bar has no room for, as one scrollable list of rows —
 * the pattern every phone user already knows from their settings app.
 */
export default function MorePage() {
  const t = useExtracted()
  const router = useRouter()
  const user = useAuthenticatedUser()
  const { resolvedTheme, setTheme } = useTheme()
  const feedback = useFeedback()

  const { isAdmin } = useIsAdmin()
  const { year, years } = useYear()
  const yearSheet = useYearSheet()

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
        {
          icon: ChartNoAxesCombinedIcon,
          label: t("Insights"),
          href: "/insights",
        },
        { icon: SparklesIcon, label: t("Year in review"), href: "/review" },
      ],
    },
    {
      label: t("Settings"),
      items: [
        { icon: UserIcon, label: t("Profile"), href: "/settings" },
        {
          icon: PaletteIcon,
          label: t("Appearance"),
          href: "/settings/appearance",
        },
        {
          icon: ChartNoAxesCombinedIcon,
          label: t("Year & periods"),
          href: "/settings/year",
        },
        { icon: InfoIcon, label: t("About"), href: "/settings/about" },
      ],
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

      <div className="flex flex-col gap-5">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors active:bg-accent"
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
                setTheme(checked ? "dark" : "light")
              }}
            />
          </div>
        </div>

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

                const className = `flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-accent ${
                  index > 0 ? "border-t" : ""
                }`

                return item.href ? (
                  <Link key={item.label} href={item.href} className={className}>
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

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Avermate · {t("Made for students")}
        </p>
      </div>
    </>
  )
}
