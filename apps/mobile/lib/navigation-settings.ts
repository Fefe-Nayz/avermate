import { useSyncExternalStore } from "react";
import type { IconName } from "@/components/icon";

/**
 * The customizable part of the shell, shared with the web: an account picks
 * three tab destinations; everything else lives behind "More". Stored
 * choices are sanitized at read time so a rename or a bad write can never
 * take the tab bar down.
 */

export interface NavTabEntry {
  href: CustomizableHref;
  /** expo-router route name inside the (tabs) group. */
  route: string;
  /** Source-language label; screens translate through t(). */
  label: string;
  icon: IconName;
}

export const CUSTOMIZABLE_NAV_HREFS = [
  "/dashboard",
  "/subjects",
  "/grades",
  "/goals",
  "/insights",
  "/social",
] as const;

export type CustomizableHref = (typeof CUSTOMIZABLE_NAV_HREFS)[number];

export const NAV_TAB_ENTRIES: readonly NavTabEntry[] = [
  {
    href: "/dashboard",
    route: "index",
    label: "Home",
    icon: "layout-dashboard",
  },
  {
    href: "/subjects",
    route: "subjects",
    label: "Subjects",
    icon: "book-marked",
  },
  { href: "/grades", route: "grades", label: "Grades", icon: "list-checks" },
  { href: "/goals", route: "goals", label: "Goals", icon: "target" },
  {
    href: "/insights",
    route: "insights",
    label: "Insights",
    icon: "chart-combined",
  },
  { href: "/social", route: "social", label: "Social", icon: "people-outline" },
];

export const TAB_SLOT_COUNT = 3;
export const DEFAULT_TAB_HREFS: readonly CustomizableHref[] = [
  "/dashboard",
  "/subjects",
  "/grades",
];

/** Unknown hrefs drop, duplicates collapse, missing slots refill in order. */
export function sanitizeTabSelection(
  stored: readonly string[] | undefined,
): CustomizableHref[] {
  const allowed = new Set<string>(CUSTOMIZABLE_NAV_HREFS);
  const chosen: CustomizableHref[] = [];
  for (const href of stored ?? []) {
    if (allowed.has(href) && !chosen.includes(href as CustomizableHref)) {
      chosen.push(href as CustomizableHref);
    }
  }
  for (const href of DEFAULT_TAB_HREFS) {
    if (chosen.length >= TAB_SLOT_COUNT) break;
    if (!chosen.includes(href)) chosen.push(href);
  }
  return chosen.slice(0, TAB_SLOT_COUNT);
}

let currentTabs: CustomizableHref[] = [...DEFAULT_TAB_HREFS];
let revision = 0;
const listeners = new Set<() => void>();

export function setNavigationSettings(value: {
  tabs?: readonly string[];
}): void {
  const next = sanitizeTabSelection(value.tabs);
  if (next.join("|") === currentTabs.join("|")) return;
  currentTabs = next;
  revision += 1;
  for (const listener of listeners) listener();
}

export function navigationTabs(): readonly CustomizableHref[] {
  return currentTabs;
}

export function useNavigationTabs(): readonly NavTabEntry[] {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision,
    () => 0,
  );
  return currentTabs.map((href) =>
    NAV_TAB_ENTRIES.find((entry) => entry.href === href)!,
  );
}
