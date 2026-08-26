"use client"

import Link from "next/link"
import { useCallback, useMemo } from "react"
import {
  BellIcon,
  ChevronLeftIcon,
  MonitorIcon,
  MoonIcon,
  MoreHorizontalIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  ResponsiveBreadcrumb,
  type ResponsiveBreadcrumbProps,
  type SeparatorNavItem,
} from "@/components/ui/responsive-breadcrumb"
import { useBreadcrumbs } from "@/components/breadcrumb/use-breadcrumbs"
import { usePageChrome } from "./page-chrome"
import { useCommandPalette } from "@/components/command/command-palette"
import { useThemeControl } from "@/hooks/use-preferences"
import { haptic } from "@/lib/haptics"
import type { AuthenticatedUser } from "@/lib/authenticated-user"
import { AssistantPanelTrigger } from "@/components/assistant/assistant-panel"
import { ModeToggle } from "./mode-toggle"
import { NavUser } from "./nav-user"
import { PeriodSwitcher } from "./period-switcher"
import { TimelineTrigger } from "./timeline-banner"

/**
 * The desktop header.
 *
 * Left to right: where you are (trigger, trail), what you are looking for
 * (search), which slice of the year the numbers cover, then the utilities
 * that belong to no single page, then you. Each of those four groups has
 * exactly one home — the sidebar carries destinations and the avatar menu
 * carries the account, so nothing appears twice.
 */
/** The dot that marks the chosen theme in the folded menu. */
function Chosen() {
  return <span aria-hidden className="size-1.5 rounded-full bg-primary" />
}

export function SiteHeader({ user }: { user: AuthenticatedUser }) {
  const t = useExtracted()
  const crumbs = useBreadcrumbs()
  const chrome = usePageChrome()
  const parentCrumb = crumbs.length > 1 ? crumbs.at(-2) : undefined
  const backHref = chrome.backHref ?? parentCrumb?.href
  const palette = useCommandPalette()
  const { theme, resolvedTheme, setPreferredTheme } = useThemeControl()

  const choose = useCallback(
    (next: "light" | "dark" | "system") => {
      haptic("selection")
      setPreferredTheme(next)
    },
    [setPreferredTheme]
  )

  const items = useMemo(
    () =>
      crumbs.map((crumb) => ({
        key: crumb.key,
        label: crumb.label,
        href: crumb.href,
        icon: crumb.icon,
        clickable: Boolean(crumb.href),
      })),
    [crumbs]
  )

  // A crumb's siblings hang off the separator that precedes it, which is what
  // turns the trail into a way to move sideways through the subject tree.
  const separatorNavItems = useMemo<Record<string, SeparatorNavItem[]>>(() => {
    const map: Record<string, SeparatorNavItem[]> = {}
    for (const crumb of crumbs) {
      if (!crumb.siblings?.length) continue
      map[crumb.key] = crumb.siblings.map((sibling) => ({
        key: sibling.key,
        label: sibling.label,
        href: sibling.href,
        clickable: true,
      }))
    }
    return map
  }, [crumbs])

  const renderItemLink = useCallback<
    NonNullable<ResponsiveBreadcrumbProps["renderItemLink"]>
  >(
    ({ href, children, onClick, ariaDisabled, itemProp }) => (
      <Link
        href={href}
        prefetch
        onClick={onClick}
        aria-disabled={ariaDisabled || undefined}
        itemProp={itemProp}
      >
        {children}
      </Link>
    ),
    []
  )

  const renderMenuLink = useCallback<
    NonNullable<ResponsiveBreadcrumbProps["renderMenuLink"]>
  >(
    ({ href, children, ariaLabel, onClick }) => (
      <Link href={href} prefetch aria-label={ariaLabel} onClick={onClick}>
        {children}
      </Link>
    ),
    []
  )

  return (
    <header className="pt-safe sticky top-0 z-30 hidden h-[calc(var(--header-h)+var(--spacing-safe-top))] shrink-0 items-center gap-1 border-b bg-background/80 pr-[max(0.75rem,var(--spacing-safe-right))] pl-[max(0.75rem,var(--spacing-safe-left))] backdrop-blur-sm md:flex">
      <SidebarTrigger className="-ml-1" />
      {/*
        The way out, on desktop too.
        
        `backHref` was only ever drawn by the mobile header, so a page like
        Action activity — reached from inside a conversation — had no visible
        return on a wide screen at all. The trail names the parent, but a back
        arrow is what a reader looks for first.
      */}
      {backHref ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Go back")}
          render={<Link href={backHref} />}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
      ) : null}
      <Separator
        orientation="vertical"
        className="mx-1.5 data-vertical:h-4 data-vertical:self-auto"
      />

      <div className="min-w-0 flex-1">
        <ResponsiveBreadcrumb
          items={items}
          className="w-full"
          strategy="center"
          preference="minimize-count"
          alwaysShow={{ head: 1, tail: 1 }}
          separatorNavItems={separatorNavItems}
          separatorNavSide="right"
          renderItemLink={renderItemLink}
          renderMenuLink={renderMenuLink}
          showHomeIcon={false}
          showCurrentInNav="never"
          enableTruncation
          truncateMinWidth={72}
          truncateThreshold={140}
          fallbackAtWidth={180}
          lockOnOverlayOpen
          overflowBehavior="collapse"
          schema="none"
          strings={{
            navigateTo: (label) => t("Navigate to {label}", { label }),
            showCollapsedItems: (count) =>
              count === 1
                ? t("Show collapsed breadcrumb item")
                : t("Show {count} collapsed breadcrumb items", {
                    count: String(count),
                  }),
            moreOptions: t("Breadcrumb"),
            nextItems: t("Next pages"),
            showSiblingItems: (label) =>
              t("Open navigation for {label}", { label }),
            noItemsAvailable: t("No pages available"),
            itemLabelFallback: t("page"),
            truncatedItemTooltip: (label) => label,
            measureEllipsis: t("Measure collapsed items"),
            measureNextItems: t("Measure next pages"),
          }}
        />
      </div>

      <div className="flex min-w-0 flex-1 justify-end px-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => palette.open()}
          className="hidden w-full max-w-[300px] min-w-28 justify-start gap-2 font-normal text-muted-foreground lg:inline-flex"
        >
          <SearchIcon className="size-4 shrink-0" />
          <span className="truncate">{t("Search")}</span>
          <Kbd className="ml-auto">⌘K</Kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Search")}
          onClick={() => palette.open()}
          className="lg:hidden"
        >
          <SearchIcon className="size-4" />
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <TimelineTrigger />
        <PeriodSwitcher />

        <Separator
          orientation="vertical"
          className="mx-1.5 data-vertical:h-4 data-vertical:self-auto"
        />

        {/* Above this width the utilities read as three quiet icons; below it
            they would crowd the trail, so they fold into one menu. */}
        {/* Outside the folding cluster on purpose: the assistant is a
            feature, not a utility, and below 1001px that cluster collapses
            into a "More options" menu. Leaving it in there meant a phone had
            no way to open the assistant at all. */}
        <AssistantPanelTrigger />

        <div className="hidden items-center gap-1 min-[1001px]:flex">
          <ModeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Announcements")}
            render={<Link href="/announcements" />}
          >
            <BellIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Settings")}
            render={<Link href="/settings" />}
          >
            <SettingsIcon className="size-4" />
          </Button>
        </div>

        <div className="min-[1001px]:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("More options")}
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem render={<Link href="/announcements" />}>
                  <BellIcon className="size-4" />
                  {t("Announcements")}
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/settings" />}>
                  <SettingsIcon className="size-4" />
                  {t("Settings")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {resolvedTheme === "dark" ? (
                      <MoonIcon className="size-4" />
                    ) : (
                      <SunIcon className="size-4" />
                    )}
                    {t("Colour theme")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent alignOffset={-8}>
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => choose("light")}>
                        <SunIcon className="size-4" />
                        <span className="flex-1">{t("Light")}</span>
                        {theme === "light" ? <Chosen /> : null}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => choose("dark")}>
                        <MoonIcon className="size-4" />
                        <span className="flex-1">{t("Dark")}</span>
                        {theme === "dark" ? <Chosen /> : null}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => choose("system")}>
                        <MonitorIcon className="size-4" />
                        <span className="flex-1">{t("System")}</span>
                        {theme === "system" ? <Chosen /> : null}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Separator
          orientation="vertical"
          className="mx-1.5 data-vertical:h-4 data-vertical:self-auto"
        />
        <NavUser user={user} iconOnly />
      </div>
    </header>
  )
}
