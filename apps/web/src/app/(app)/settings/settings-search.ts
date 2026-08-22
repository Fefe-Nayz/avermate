export function normalizeSettingsSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()
}

function settingsHaystackMatches(haystack: string, query: string): boolean {
  const needle = normalizeSettingsSearch(query)
  if (!needle) return true
  const normalizedHaystack = normalizeSettingsSearch(haystack)
  return needle
    .split(/\s+/)
    .every((token) => normalizedHaystack.includes(token))
}

export function settingsSectionMatches(
  section: {
    label: string
    href: string
    searchTerms?: readonly string[]
  },
  query: string
): boolean {
  return settingsHaystackMatches(
    `${section.label} ${section.href} ${(section.searchTerms ?? []).join(" ")}`,
    query
  )
}

export function settingsItemMatches(
  section: {
    label: string
    href: string
    searchTerms?: readonly string[]
  },
  item: {
    label: string
    href: string
    searchTerms?: readonly string[]
  },
  query: string
): boolean {
  return settingsHaystackMatches(
    `${section.label} ${section.href} ${item.label} ${item.href} ${(item.searchTerms ?? []).join(" ")}`,
    query
  )
}

export type SettingsSearchResult<TSection, TItem> =
  | { kind: "item"; item: TItem; section: TSection }
  | { kind: "section"; item: null; section: TSection }

export function settingsResultsForSection<
  TItem extends {
    label: string
    href: string
    searchTerms?: readonly string[]
  },
  TSection extends {
    label: string
    href: string
    searchTerms?: readonly string[]
    items?: readonly TItem[]
  },
>(section: TSection, query: string): SettingsSearchResult<TSection, TItem>[] {
  const itemResults = (section.items ?? [])
    .filter((item) => settingsItemMatches(section, item, query))
    .map((item) => ({ kind: "item" as const, item, section }))
  if (itemResults.length > 0) return itemResults
  return settingsSectionMatches(section, query)
    ? [{ kind: "section" as const, item: null, section }]
    : []
}
