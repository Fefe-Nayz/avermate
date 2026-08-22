import { describe, expect, test } from "bun:test"
import {
  settingsItemMatches,
  settingsResultsForSection,
  settingsSectionMatches,
} from "./settings-search"
import { SETTINGS_SECTIONS } from "@/lib/nav"

const integrations = {
  label: "Intégrations",
  href: "/settings/integrations",
}

describe("settings search", () => {
  test("matches translated labels without requiring accents", () => {
    expect(settingsSectionMatches(integrations, "integrations")).toBe(true)
  })

  test("matches stable route vocabulary as well as the visible label", () => {
    expect(settingsSectionMatches(integrations, "settings/integr")).toBe(true)
    expect(settingsSectionMatches(integrations, "appearance")).toBe(false)
  })

  test("keeps every section visible for an empty query", () => {
    expect(settingsSectionMatches(integrations, "  ")).toBe(true)
  })

  test("finds a section by the settings it contains", () => {
    expect(
      settingsSectionMatches(
        {
          label: "Ajustements de moyenne",
          href: "/settings/adjustments",
          searchTerms: ["bonus période matière"],
        },
        "bonus"
      )
    ).toBe(true)
    expect(
      settingsSectionMatches(
        {
          ...integrations,
          searchTerms: ["Moodle Pronote ÉcoleDirecte Skolengo MCP"],
        },
        "ecoledirecte"
      )
    ).toBe(true)
  })

  test("returns the concrete setting rather than only its page", () => {
    expect(
      settingsItemMatches(
        integrations,
        {
          label: "Clé de service IA",
          href: "/settings/integrations#ai-keys",
          searchTerms: ["Mistral OCR transcription BYOK"],
        },
        "ocr"
      )
    ).toBe(true)
    expect(
      settingsItemMatches(
        integrations,
        {
          label: "Clé de service IA",
          href: "/settings/integrations#ai-keys",
        },
        "bonus"
      )
    ).toBe(false)
  })

  test("matches multi-word queries regardless of metadata order", () => {
    expect(
      settingsItemMatches(
        integrations,
        {
          label: "Mistral OCR",
          href: "/settings/integrations#ai-keys",
          searchTerms: ["clé API document"],
        },
        "clé Mistral"
      )
    ).toBe(true)
    expect(
      settingsItemMatches(
        integrations,
        {
          label: "PEM certificate chain",
          href: "/settings/integrations#moodle",
          searchTerms: ["certificat CA privé"],
        },
        "certificat CA"
      )
    ).toBe(true)
  })

  test("does not fan broad section vocabulary out to every control", () => {
    expect(
      settingsItemMatches(
        {
          label: "Apparence",
          href: "/settings/appearance",
          searchTerms: ["theme graphique police haptique"],
        },
        {
          label: "Style des lignes",
          href: "/settings/appearance#charts",
        },
        "graphique lignes"
      )
    ).toBe(false)
  })

  test("returns one section result when only section metadata matches", () => {
    const section = {
      label: "Apparence",
      href: "/settings/appearance",
      searchTerms: ["theme graphique police haptique"],
      items: [
        {
          label: "Style des lignes",
          href: "/settings/appearance#charts",
        },
        {
          label: "Retour haptique",
          href: "/settings/appearance#motion",
        },
      ],
    }
    expect(settingsResultsForSection(section, "theme")).toEqual([
      { kind: "section", item: null, section },
    ])
    expect(settingsResultsForSection(section, "haptique")).toEqual([
      {
        kind: "item",
        item: section.items[1],
        section,
      },
    ])
  })

  test("indexes controls beyond the page titles", () => {
    for (const query of [
      "linked sign-ins",
      "start over",
      "where you are signed in",
      "install Avermate",
      "support",
      "the general average",
      "who you are",
      "colour and theme",
      "match my device",
      "accents",
      "typography and shape",
      "seasonal touches",
      "feel",
      "phone tab bar",
      "this year",
      "school years",
      "connected services",
      "my API keys",
      "what has access",
      "registered clients",
      "your data",
      "delete this account",
      "username",
      "school time zone",
      "student account number",
    ]) {
      expect(
        SETTINGS_SECTIONS.flatMap((section) =>
          settingsResultsForSection(section, query)
        )
      ).not.toHaveLength(0)
    }
  })

  test("routes appearance modes and colour controls to their real sections", () => {
    const appearance = SETTINGS_SECTIONS.find(
      (section) => section.href === "/settings/appearance"
    )!
    for (const query of ["dark", "light", "match my device"]) {
      expect(
        settingsResultsForSection(appearance, query).map(
          (result) => result.item?.href ?? result.section.href
        )
      ).toEqual(["/settings/appearance#theme"])
    }
    for (const query of ["accents", "build my own", "colour and theme"]) {
      expect(
        settingsResultsForSection(appearance, query).map(
          (result) => result.item?.href ?? result.section.href
        )
      ).toContain("/settings/appearance#cards")
    }
  })
})
