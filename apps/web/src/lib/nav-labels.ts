"use client"

import { useExtracted } from "next-intl"
import { SETTINGS_SECTIONS } from "./nav"

/**
 * The settings sections' labels, translated.
 *
 * `NAV_ENTRIES` and `SETTINGS_SECTIONS` carry source-language strings because
 * extraction needs to see a literal inside `t()`, and a list of routes cannot
 * call a hook. So the mapping lives here rather than in each screen: the rail
 * and the account hub render the same list, and a label they disagreed on would
 * be the same drift the shared list exists to end.
 */
export function useSettingsSectionLabels() {
  const t = useExtracted()
  return {
    Profile: t("Profile"),
    Appearance: t("Appearance"),
    Navigation: t("Navigation"),
    "Year & periods": t("Year & periods"),
    "Year preset": t("Year preset"),
    "Custom averages": t("Custom averages"),
    Account: t("Account"),
    Integrations: t("Integrations"),
    About: t("About"),
  }
}

/** Every section, labelled — the order both surfaces present them in. */
export function useSettingsSections() {
  // Through a Map rather than indexing the record: the record's keys are the
  // nine literals above, a section's label is a `string`, and looking one up
  // would need an assertion that the two always agree. The fallback below is
  // the honest answer for a section whose label has not been translated yet.
  const labels = new Map(Object.entries(useSettingsSectionLabels()))
  return SETTINGS_SECTIONS.map((section) => ({
    ...section,
    label: labels.get(section.label) ?? section.label,
  }))
}
