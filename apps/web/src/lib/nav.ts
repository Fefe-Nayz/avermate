import {
  BookMarkedIcon,
  ChartNoAxesCombinedIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  TargetIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * The app's routes, declared once.
 *
 * The sidebar, the mobile tab bar, the breadcrumb and the command palette all
 * read from this list, so a new screen appears in every navigation surface at
 * the same time and can never be reachable from only one of them.
 */

export interface NavEntry {
  href: string;
  /** Source-language label; screens translate it through `useExtracted`. */
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that should light this entry up. */
  matches?: string[];
  /** Shown in the mobile tab bar. */
  tab?: boolean;
  adminOnly?: boolean;
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
];

export const SETTINGS_SECTIONS = [
  { href: "/settings", label: "Profile", exact: true },
  { href: "/settings/appearance", label: "Appearance" },
  { href: "/settings/year", label: "Year & periods" },
  { href: "/settings/averages", label: "Custom averages" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/about", label: "About" },
] as const;

export function isActivePath(pathname: string, entry: NavEntry): boolean {
  const candidates = [entry.href, ...(entry.matches ?? [])];
  return candidates.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
