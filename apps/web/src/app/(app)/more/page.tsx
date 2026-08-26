"use client"

import Link from "next/link"
import { useState } from "react"
import { useThemeControl } from "@/hooks/use-preferences"
import { useRouter } from "next/navigation"
import {
  ChartNoAxesCombinedIcon,
  BellIcon,
  CalendarRangeIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  FolderOpenIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  MoonIcon,
  ShieldIcon,
  SparklesIcon,
  SearchIcon,
  SunIcon,
  XIcon,
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
import {
  normalizeSettingsSearch,
  settingsResultsForSection,
} from "../settings/settings-search"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

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
  const [query, setQuery] = useState("")

  const groups: Array<{
    label?: string
    items: Array<{
      icon: LucideIcon
      label: string
      /** The section a search hit came from, so a row says where it lives. */
      caption?: string
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
          icon: CalendarRangeIcon,
          label: t("Planning"),
          href: "/planning",
        },
        {
          icon: FolderOpenIcon,
          label: t("Materials"),
          href: "/materials",
        },
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

  /**
   * Searching from here rather than from inside the settings pages.
   *
   * The rail's search sat above every one of the eleven settings screens on a
   * phone, which is a field repeated on each of the pages it can send you to.
   * A phone reaches all of them from this list, so this is the one place the
   * search is worth having — and it searches everything on the page, not only
   * the settings half of it.
   */
  const needle = normalizeSettingsSearch(query)

  /**
   * Searching reaches inside the settings, not only their titles.
   *
   * The rail on a wide screen answers "dark mode" with the row that carries it,
   * two levels down inside Appearance. A phone asking the same question of the
   * same list has to get the same answer, so the settings group is rebuilt from
   * the item-level matches while a query is set — the same model the rail uses,
   * so the two cannot answer differently.
   */
  const settingsHits = needle
    ? settings.flatMap((section) =>
        settingsResultsForSection(section, query).map(({ kind, item }) => ({
          icon: section.icon,
          label: item?.label ?? section.label,
          caption: kind === "section" ? undefined : section.label,
          href: item?.href ?? section.href,
          onClick: undefined,
          destructive: false,
        }))
      )
    : []

  const visibleGroups = needle
    ? groups
        .map((group) =>
          group.label === t("Settings")
            ? { ...group, items: settingsHits }
            : {
                ...group,
                items: group.items.filter((item) =>
                  normalizeSettingsSearch(
                    `${item.label} ${item.href ?? ""}`
                  ).includes(needle)
                ),
              }
        )
        .filter((group) => group.items.length > 0)
    : groups

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
              aria-label={t("Dark mode")}
              checked={resolvedTheme === "dark"}
              onCheckedChange={(checked) => {
                haptic("selection")
                setPreferredTheme(checked ? "dark" : "light")
              }}
            />
          </div>
        </div>

        <InputGroup className="h-(--control-h-search)">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search settings and screens…")}
            aria-label={t("Search settings and screens…")}
            // WebKit draws its own cancel button inside a search field, beside
            // ours — one clear button too many.
            className="[&::-webkit-search-cancel-button]:appearance-none"
          />
          {query ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={t("Clear the search")}
                onClick={() => setQuery("")}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        {visibleGroups.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {t("Nothing matches that.")}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
          {visibleGroups.map((group, groupIndex) => (
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
                            ? "min-w-0 flex-1 text-sm text-destructive"
                            : "min-w-0 flex-1 text-sm"
                        }
                      >
                        <span className="block truncate">{item.label}</span>
                        {/* A search hit two levels down says which section it
                            lives in; without it "Dark mode" and "Theme" are
                            two rows with no home. */}
                        {item.caption ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.caption}
                          </span>
                        ) : null}
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
