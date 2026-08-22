"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useMemo, useState } from "react"
import { SearchIcon, XIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { isActiveSettingsSection } from "@/lib/nav"
import { useSettingsSections } from "@/lib/nav-labels"
import { cn } from "@/lib/utils"
import { settingsResultsForSection } from "./settings-search"
import {
  useSettingsHashHighlight,
  useSettingsResultClick,
} from "@/components/settings/use-settings-highlight"

/**
 * Only the active-route highlight needs the browser.
 *
 * The icons are not decoration: nine near-identical text rows are read one by
 * one, where a shape is recognised at a glance, and the same glyph appears on
 * the section's own heading so the rail and the page agree.
 */
export function SettingsNavigation() {
  const t = useExtracted()
  const pathname = usePathname()
  const [query, setQuery] = useState("")
  // The ring is stamped rather than derived from `:target`: picking the same
  // result twice changes no hash, and nothing would happen the second time.
  const ringSection = useSettingsResultClick()
  useSettingsHashHighlight()

  // Shared with the account hub, which is the only way onto these screens on a
  // phone — this rail is `hidden md:block`.
  const sections = useSettingsSections()
  const matchingItems = useMemo(
    () =>
      query.trim()
        ? sections.flatMap((section) =>
            settingsResultsForSection(section, query)
          )
        : [],
    [query, sections]
  )

  return (
    // Hidden outright on a phone rather than stacked above every settings
    // page: the phone reaches these screens from "More", and that is where the
    // search belongs — one full-screen list, not a field repeated on each of
    // the eleven pages it can send you to.
    <nav className="hidden w-full shrink-0 md:block md:w-52">
      <h1 className="mb-3 hidden text-2xl font-semibold tracking-tight md:block">
        {t("Settings")}
      </h1>
      {/* The field is an input group, so the magnifier and the clear button are
          real slots either side of the input rather than icons floated over it
          — which is what let the old one put a decorative magnifier where the
          text starts and no way to empty the field at all. */}
      <InputGroup className="mb-3 h-(--control-h-search)">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search settings…")}
          aria-label={t("Search settings")}
          // `type="search"` keeps Escape-to-clear and the right announcement,
          // but WebKit draws its own cancel button inside the field — beside
          // ours, which is one clear button too many.
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
      <ul className="flex flex-col gap-0.5">
        {query.trim()
          ? matchingItems.map(({ kind, item, section }) => {
              const Icon = section.icon
              const href = item?.href ?? section.href
              const label = item?.label ?? section.label
              return (
                <li key={`${kind}:${href}:${label}`}>
                  <Link
                    href={href}
                    onClick={() => ringSection(href)}
                    className="flex items-start gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block leading-tight text-foreground">
                        {label}
                      </span>
                      <span className="mt-0.5 block truncate text-xs">
                        {kind === "section"
                          ? t("Settings section")
                          : section.label}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })
          : sections.map((section) => {
              const active = isActiveSettingsSection(pathname, section)
              const Icon = section.icon
              return (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {section.label}
                  </Link>
                </li>
              )
            })}
      </ul>
      {query.trim() && matchingItems.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          {t("No setting matches.")}
        </p>
      ) : null}
    </nav>
  )
}
