import {
  BookMarkedIcon,
  CalendarRangeIcon,
  ChartNoAxesCombinedIcon,
  CompassIcon,
  FunctionSquareIcon,
  InfoIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  PaletteIcon,
  PlugIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SparklesIcon,
  TargetIcon,
  UserRoundIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react"

/**
 * The app's routes, declared once.
 *
 * The sidebar, the mobile tab bar, the breadcrumb and the command palette all
 * read from this list, so a new screen appears in every navigation surface at
 * the same time and can never be reachable from only one of them.
 */

export interface NavEntry {
  href: string
  /** Source-language label; screens translate it through `useExtracted`. */
  label: string
  icon: LucideIcon
  /** Extra path prefixes that should light this entry up. */
  matches?: string[]
  /** Shown in the mobile tab bar. */
  tab?: boolean
  adminOnly?: boolean
  /** Hidden until the request-prefetched eligibility projection is active. */
}

export const NAV_ENTRIES: NavEntry[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    tab: true,
  },
  {
    href: "/subjects",
    label: "Subjects",
    icon: BookMarkedIcon,
    tab: true,
  },
  {
    href: "/grades",
    label: "Grades",
    icon: ListChecksIcon,
    tab: true,
  },
  {
    href: "/goals",
    label: "Goals",
    icon: TargetIcon,
  },
  {
    href: "/insights",
    label: "Insights",
    icon: ChartNoAxesCombinedIcon,
  },
  {
    href: "/social",
    label: "Social",
    icon: UsersRoundIcon,
  },
  {
    href: "/review",
    label: "Year in review",
    icon: SparklesIcon,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
  },
  {
    href: "/admin",
    label: "Admin",
    icon: ShieldIcon,
    adminOnly: true,
  },
]

export interface SettingsSection {
  href: string
  /** Source-language label; screens translate it through `useExtracted`. */
  label: string
  icon: LucideIcon
  /** Lit only on an exact match: `/settings` is a page, not a section root. */
  exact?: boolean
}

/**
 * The settings screens, declared once — for the same reason as above.
 *
 * This list existed and was read by nothing: the desktop rail kept its own
 * copy, which grew two sections this one never heard about, and the account hub
 * on a phone hand-picked four of them. The rail is `hidden md:block`, so those
 * five sections — Navigation, Year preset, Custom averages, Account,
 * Integrations — could not be reached on a phone at all. Nothing was broken;
 * there were simply three lists and only one of them was ever complete.
 *
 * Both surfaces now render this, so a new settings screen reaches the phone and
 * the desktop at the same time or neither.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { href: "/settings", label: "Profile", icon: UserRoundIcon, exact: true },
  { href: "/settings/appearance", label: "Appearance", icon: PaletteIcon },
  { href: "/settings/navigation", label: "Navigation", icon: CompassIcon },
  { href: "/settings/year", label: "Year & periods", icon: CalendarRangeIcon },
  { href: "/settings/preset", label: "Year preset", icon: ScrollTextIcon },
  {
    href: "/settings/averages",
    label: "Custom averages",
    icon: FunctionSquareIcon,
  },
  { href: "/settings/account", label: "Account", icon: ShieldCheckIcon },
  { href: "/settings/integrations", label: "Integrations", icon: PlugIcon },
  { href: "/settings/about", label: "About", icon: InfoIcon },
]

/** Whether `pathname` is inside a settings section. */
export function isActiveSettingsSection(
  pathname: string,
  section: SettingsSection
): boolean {
  return section.exact
    ? pathname === section.href
    : pathname.startsWith(section.href)
}

export function isActivePath(pathname: string, entry: NavEntry): boolean {
  const candidates = [entry.href, ...(entry.matches ?? [])]
  return candidates.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
}

/**
 * The destinations an account may pin to its navigation: the six primary
 * screens. Settings, review and admin stay where they are — the first is
 * chrome, the others are conditional.
 */
export const CUSTOMIZABLE_NAV_HREFS = [
  "/dashboard",
  "/subjects",
  "/grades",
  "/goals",
  "/insights",
  "/social",
] as const

/** The mobile tab bar's free slots (the fourth tab is always "More"). */
export const TAB_SLOT_COUNT = 3

export const DEFAULT_TAB_HREFS = ["/dashboard", "/subjects", "/grades"]

export const DEFAULT_SIDEBAR_HREFS = [...CUSTOMIZABLE_NAV_HREFS]

/**
 * A stored navigation choice survives renames and bad writes by being
 * sanitized at read time: unknown hrefs drop, duplicates collapse, and when
 * a fixed count is asked for, missing slots refill from the fallback.
 */
export function sanitizeNavSelection(
  stored: readonly string[] | undefined,
  fallback: readonly string[],
  count?: number
): string[] {
  const allowed = new Set<string>(CUSTOMIZABLE_NAV_HREFS)
  const chosen: string[] = []
  for (const href of stored ?? []) {
    if (allowed.has(href) && !chosen.includes(href)) chosen.push(href)
  }
  if (count === undefined) {
    return chosen.length > 0 ? chosen : [...fallback]
  }
  for (const href of fallback) {
    if (chosen.length >= count) break
    if (!chosen.includes(href)) chosen.push(href)
  }
  return chosen.slice(0, count)
}
