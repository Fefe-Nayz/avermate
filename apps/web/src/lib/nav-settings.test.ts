import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { SETTINGS_SECTIONS, isActiveSettingsSection } from "./nav"

const settingsDir = new URL("../app/(app)/settings/", import.meta.url)

/** Every settings screen on disk, as the route that reaches it. */
const routes = readdirSync(settingsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
  .map((entry) => `/settings/${entry.name}`)

describe("settings sections", () => {
  test("lists every settings screen, so a phone can reach all of them", () => {
    // The rail that used to be the only complete list is `hidden md:block`, so a
    // screen missing here is a screen with no way in on a phone. Five were, and
    // nothing failed — which is why this reads the directory rather than a list
    // someone has to remember to update.
    const listed = new Set(SETTINGS_SECTIONS.map((section) => section.href))
    const missing = routes.filter(
      (route) =>
        // Sub-routes of a section are reached from inside it, not from the hub.
        !listed.has(route) && !route.startsWith("/settings/averages/")
    )

    expect(missing).toEqual([])
    expect(listed.has("/settings")).toBe(true)
  })

  test("is read by both surfaces rather than copied into them", () => {
    // The drift this ended: the rail and the account hub each had their own
    // list. Either one holding a `/settings/...` literal is the drift returning.
    for (const file of [
      "../app/(app)/settings/settings-navigation.tsx",
      "../app/(app)/more/page.tsx",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8")

      expect(source).toContain("useSettingsSections")
      expect(source).not.toContain('"/settings/')
    }
  })

  test("lights the profile page only on an exact match", () => {
    const profile = SETTINGS_SECTIONS.find(
      (section) => section.href === "/settings"
    )
    const appearance = SETTINGS_SECTIONS.find(
      (section) => section.href === "/settings/appearance"
    )
    if (!profile || !appearance) throw new Error("sections missing")

    // Without `exact`, Profile would stay lit on every settings screen, since
    // every one of their paths starts with its href.
    expect(isActiveSettingsSection("/settings", profile)).toBe(true)
    expect(isActiveSettingsSection("/settings/appearance", profile)).toBe(false)
    expect(isActiveSettingsSection("/settings/appearance", appearance)).toBe(
      true
    )
  })
})
