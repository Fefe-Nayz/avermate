"use client"

import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import { SelectControl } from "@/components/forms/controls"
import { TabBarEditor } from "./tab-bar-editor"
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

  /** The screens no seat holds, in the registry's order rather than the order they left. */
  const hiddenTabs = CUSTOMIZABLE_NAV_HREFS.filter(
    (href) => !tabs.includes(href)
  )
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
          title={t("Phone tab bar")}
          description={t(
            "Drag a screen into a seat. Three are yours; the add button and More keep theirs, so every screen stays reachable."
          )}
        >
          <TabBarEditor
            tabs={tabs}
            pool={hiddenTabs}
            labels={labels}
            onChange={saveTabs}
          />
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
            {/* The button belongs to the sidebar, so it lives in the sidebar's
                own card — one section for the thing, not two sections that both
                say "sidebar" and sit in different places. Ruled off rather than
                merely spaced, because it is a different *kind* of choice: the
                lists above arrange where you can go, this one adds something that
                creates. */}
            <div className="flex flex-col gap-2 border-t pt-4">
              <div className="px-1">
                <p className="text-xs font-medium">{t("Button at the top")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t(
                    "A sidebar is for going places. If one thing you create is worth a seat above them, choose which."
                  )}
                </p>
              </div>
              <SelectControl
                aria-label={t("Button at the top")}
                value={
                  preferences.navigation.sidebarAction ?? NO_SIDEBAR_ACTION
                }
                onValueChange={(value) => {
                  if (!value) return
                  saveSidebarAction(
                    value === NO_SIDEBAR_ACTION ? undefined : value
                  )
                }}
                options={[
                  { value: NO_SIDEBAR_ACTION, label: t("No button") },
                  ...quickAddActions.map((candidate) => ({
                    value: candidate.href,
                    label: candidate.addLabel,
                  })),
                ]}
              />
            </div>
          </div>
        </SettingsSection>
      </div>
    </>
  )
}
