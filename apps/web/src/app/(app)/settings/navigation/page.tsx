"use client"

import { useExtracted } from "next-intl"
import { EllipsisIcon, PlusIcon } from "lucide-react"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import { SelectControl } from "@/components/forms/controls"
import {
  DragHandle,
  SortableList,
  SortableRow,
  sortableListClassName,
  sortableRowClassName,
} from "@/components/ui/sortable-list"
import { useQuickAddActions } from "@/components/shell/quick-add"
import { Switch } from "@/components/ui/switch"
import { usePreferences } from "@/hooks/use-preferences"
import {
  CUSTOMIZABLE_NAV_HREFS,
  DEFAULT_SIDEBAR_HREFS,
  DEFAULT_TAB_HREFS,
  NAV_ENTRIES,
  sanitizeNavSelection,
  TAB_SLOT_COUNT,
} from "@/lib/nav"
import { haptic } from "@/lib/haptics"

/**
 * The navigation is the account's to arrange: three free seats on the phone
 * tab bar (the fourth stays "More", so nothing is ever unreachable) and the
 * sidebar's order and visibility. Everything hidden here remains reachable
 * from More and the command palette — this page arranges, it never locks
 * anything away.
 */
/**
 * The select's stand-in for "nothing".
 *
 * `SelectControl` speaks in strings, and the preference's own way of saying no is to
 * be absent — so the two need a token between them rather than an empty string,
 * which a select cannot tell apart from an unset value.
 */
const NO_SIDEBAR_ACTION = "none"

export default function NavigationSettingsPage() {
  const t = useExtracted()
  const { preferences, update } = usePreferences()
  const quickAddActions = useQuickAddActions()

  const labels: Record<string, string> = {
    "/dashboard": t("Dashboard"),
    "/subjects": t("Subjects"),
    "/grades": t("Grades"),
    "/goals": t("Goals"),
    "/insights": t("Insights"),
    "/social": t("Social"),
  }

  const tabs = sanitizeNavSelection(
    preferences.navigation.tabs,
    DEFAULT_TAB_HREFS,
    TAB_SLOT_COUNT
  )
  const sidebar = sanitizeNavSelection(
    preferences.navigation.sidebar,
    DEFAULT_SIDEBAR_HREFS
  )

  const saveTabs = (next: string[]) => {
    haptic("selection")
    update({
      navigation: { ...preferences.navigation, tabs: next },
    })
  }
  const saveSidebar = (next: string[]) => {
    haptic("selection")
    update({
      navigation: { ...preferences.navigation, sidebar: next },
    })
  }
  const saveSidebarAction = (next: string | undefined) => {
    haptic("selection")
    update({
      navigation: { ...preferences.navigation, sidebarAction: next },
    })
  }

  /** Everything not seated, in the registry's order rather than the order it left. */
  const hiddenSidebar = CUSTOMIZABLE_NAV_HREFS.filter(
    (href) => !sidebar.includes(href)
  )

  return (
    <>
      <PageMeta title={t("Navigation")} backHref="/settings" />
      <div className="flex flex-col gap-6">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Navigation")}
        </h1>

        <SettingsSection
          title={t("Sidebar button")}
          description={t(
            "A sidebar is for going places. If one thing you create is worth a seat at the top of it, choose which."
          )}
        >
          <SelectControl
            aria-label={t("Sidebar button")}
            value={preferences.navigation.sidebarAction ?? NO_SIDEBAR_ACTION}
            onValueChange={(value) => {
              if (!value) return
              saveSidebarAction(value === NO_SIDEBAR_ACTION ? undefined : value)
            }}
            options={[
              { value: NO_SIDEBAR_ACTION, label: t("No button") },
              ...quickAddActions.map((candidate) => ({
                value: candidate.href,
                label: candidate.addLabel,
              })),
            ]}
          />
        </SettingsSection>

        <SettingsSection
          title={t("Phone tab bar")}
          description={t(
            "Three seats are yours; the add button and More keep theirs, so every screen stays reachable."
          )}
        >
          <div className="flex flex-col gap-3">
            <TabBarPreview tabs={tabs} labels={labels} />
            {tabs.map((href, slot) => (
              <div key={slot} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm text-muted-foreground">
                  {t("Slot {number}", { number: String(slot + 1) })}
                </span>
                <SelectControl
                  aria-label={t("Slot {number}", { number: String(slot + 1) })}
                  className="flex-1"
                  value={href}
                  onValueChange={(value) => {
                    if (!value) return
                    const next = [...tabs]
                    const elsewhere = next.indexOf(value)
                    // Choosing a screen already seated swaps the two seats
                    // instead of silently duplicating it.
                    if (elsewhere >= 0) next[elsewhere] = next[slot] as string
                    next[slot] = value
                    saveTabs(next)
                  }}
                  options={CUSTOMIZABLE_NAV_HREFS.map((candidate) => ({
                    value: candidate,
                    label: labels[candidate] ?? candidate,
                  }))}
                />
              </div>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("Sidebar")}
          description={t(
            "Drag to order the screens you live in. Hidden ones stay reachable from More and the search."
          )}
        >
          {/* Two lists rather than one, because that is what the setting *is*: an
              ordered selection, and everything else. A single list had a handle on
              some rows and not others, and arrows that were disabled at the ends —
              so the rows that could move looked like the rows that could not.

              Dragging is the app's own sortable list, the same object as the custom
              averages and the goals, so this page stops being the one place where
              order is changed by pressing a button repeatedly. */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="px-1 text-xs font-medium text-muted-foreground">
                {t("In your sidebar")}
              </p>
              <SortableList ids={sidebar} onReorder={saveSidebar}>
                <ul className={sortableListClassName}>
                  {sidebar.map((href, index) => {
                    const entry = NAV_ENTRIES.find(
                      (candidate) => candidate.href === href
                    )
                    if (!entry) return null
                    return (
                      <SortableRow
                        key={href}
                        id={href}
                        className={sortableRowClassName(index)}
                      >
                        <DragHandle className="ml-1.5" />
                        <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2">
                          <entry.icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {labels[href] ?? href}
                          </span>
                          <Switch
                            aria-label={labels[href] ?? href}
                            checked
                            // The last one cannot leave: a sidebar with nothing in
                            // it is a sidebar you cannot navigate from.
                            disabled={sidebar.length <= 1}
                            onCheckedChange={() => {
                              if (sidebar.length <= 1) return
                              saveSidebar(
                                sidebar.filter((item) => item !== href)
                              )
                            }}
                          />
                        </div>
                      </SortableRow>
                    )
                  })}
                </ul>
              </SortableList>
            </div>

            {hiddenSidebar.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  {t("Hidden")}
                </p>
                <ul className={sortableListClassName}>
                  {hiddenSidebar.map((href, index) => {
                    const entry = NAV_ENTRIES.find(
                      (candidate) => candidate.href === href
                    )
                    if (!entry) return null
                    return (
                      <li key={href} className={sortableRowClassName(index)}>
                        {/* No handle: an unordered set has no order to change, and
                            a grip that did nothing would say otherwise. The gutter
                            keeps the two lists aligned all the same. */}
                        <span aria-hidden className="ml-1.5 size-8 shrink-0" />
                        <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2">
                          <entry.icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                            {labels[href] ?? href}
                          </span>
                          <Switch
                            aria-label={labels[href] ?? href}
                            checked={false}
                            onCheckedChange={() =>
                              saveSidebar([...sidebar, href])
                            }
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </SettingsSection>
      </div>
    </>
  )
}

/** A miniature of the real bar, so the choice is seen where it will live. */
function TabBarPreview({
  tabs,
  labels,
}: {
  tabs: readonly string[]
  labels: Record<string, string>
}) {
  const t = useExtracted()
  const seats = [tabs[0], tabs[1], null, tabs[2], "/more"] as const

  return (
    <div className="rounded-xl border bg-background/60 px-2 py-1.5">
      <ul className="grid grid-cols-5 items-center">
        {seats.map((href, index) => {
          if (href === null) {
            return (
              <li key="action" className="flex justify-center">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <PlusIcon className="size-4" />
                </span>
              </li>
            )
          }
          const entry = NAV_ENTRIES.find((candidate) => candidate.href === href)
          const Icon = href === "/more" ? EllipsisIcon : entry?.icon
          return (
            <li
              key={`${href}-${index}`}
              className="flex flex-col items-center gap-0.5 py-1 text-[10px] text-muted-foreground"
            >
              {Icon ? <Icon className="size-4" /> : null}
              {href === "/more" ? t("More") : (labels[href ?? ""] ?? "")}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
