import { describe, expect, test } from "bun:test"
import { migrateLegacyStickyValue } from "../hooks/use-sticky-state"
import { STICKY_COOKIE_PREFIX, stickyCookieName } from "./sticky-state"

/** Every key the app remembers, so the flattening below is tested on the real set. */
const KEYS = [
  "avermate:year",
  "avermate:period",
  "avermate:timeline",
  "avermate:grades-view",
  "goals:grouped",
]

describe("sticky state cookies", () => {
  test("flattens each key into a distinct cookie token", () => {
    const names = KEYS.map(stickyCookieName)

    expect(new Set(names).size).toBe(KEYS.length)
    for (const name of names) {
      expect(name.startsWith(STICKY_COOKIE_PREFIX)).toBe(true)
      // RFC 6265 token: no separators, so a name never needs quoting and never
      // truncates a Set-Cookie header at the wrong character.
      expect(name).toMatch(/^[A-Za-z0-9_.-]+$/)
    }
  })

  test("names the grades view the same way every render does", () => {
    expect(stickyCookieName("avermate:grades-view")).toBe(
      "avermate.ui.avermate.grades-view"
    )
  })

  /**
   * The reason this is a cookie and not localStorage: the server render has to
   * be able to read it, so a remembered layout is already in place on the first
   * paint instead of arriving a commit after hydration.
   */
  test("is read by the root layout and by the hook through the same helper", async () => {
    const [layout, hook] = await Promise.all([
      Bun.file(new URL("../app/layout.tsx", import.meta.url)).text(),
      Bun.file(new URL("../hooks/use-sticky-state.ts", import.meta.url)).text(),
    ])

    expect(layout).toContain("STICKY_COOKIE_PREFIX")
    expect(layout).toContain("<StickyStateProvider")
    expect(hook).toContain("stickyCookieName(key)")
    // Never *written* there, which is what would put the value back out of the server's
    // reach. Reading it once is a different thing and is deliberate — see below.
    expect(hook).not.toContain("localStorage.setItem")
  })

  test("adopts a choice made before any of this was a cookie", async () => {
    /**
     * The move to cookies stopped reading the old entries and nothing carried them
     * across, so an upgrading reader's remembered layouts silently reverted to the
     * defaults while still sitting in their browser's storage.
     *
     * Asserted on the source because the hook needs a DOM to run, and what has to hold
     * is structural: the old value is read, promoted to a cookie, and removed — after
     * mount, so the server render and the first client render still agree.
     */
    const hook = await Bun.file(
      new URL("../hooks/use-sticky-state.ts", import.meta.url)
    ).text()

    expect(hook).toContain("storage.getItem(key)")
    expect(hook).toContain("storage.removeItem(key)")
    // The browser store is touched from the effect, never from the hydration snapshot.
    const effect = hook.slice(hook.indexOf("useEffect("))
    expect(effect).toContain(
      "migrateLegacyStickyValue<T>(key, window.localStorage)"
    )
    // The cookie is the one source of truth. A synchronous setState in this effect both
    // trips the hooks lint and creates a second state that can drift from the cookie.
    expect(hook).not.toContain("setOverride")
    expect(hook).toContain("publishStickyChange()")
  })

  test("writes before removing the recoverable legacy value", () => {
    const calls: string[] = []
    const storage = {
      getItem: (key: string) => {
        calls.push(`read:${key}`)
        return JSON.stringify({ columns: 2 })
      },
      removeItem: (key: string) => calls.push(`remove:${key}`),
    }

    expect(
      migrateLegacyStickyValue("layout", storage, (key, value) => {
        calls.push(`write:${key}:${JSON.stringify(value)}`)
      })
    ).toBe(true)
    expect(calls).toEqual([
      "read:layout",
      'write:layout:{"columns":2}',
      "remove:layout",
    ])
  })

  test("keeps an invalid legacy value recoverable", () => {
    let removed = false
    expect(() =>
      migrateLegacyStickyValue(
        "layout",
        {
          getItem: () => "not json",
          removeItem: () => {
            removed = true
          },
        },
        () => {}
      )
    ).toThrow()
    expect(removed).toBe(false)
  })
})
