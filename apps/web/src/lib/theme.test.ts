import { describe, expect, test } from "bun:test"
import {
  customThemeCss,
  sanitizeCustomThemeCss,
  sanitizeThemeValue,
} from "./theme"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("custom theme CSS safety", () => {
  test("accepts modern colour syntax used by presets and migrations", () => {
    const values = [
      "#f97316",
      "oklch(0.72 0.17 45 / 80%)",
      "hsl(24 94% 55%)",
      "rgb(249 115 22 / 0.8)",
      "color(display-p3 0.9 0.3 0.1)",
      "color-mix(in oklch, var(--primary) 70%, #fff)",
      "var(--brand-colour, #f97316)",
    ]
    for (const value of values) expect(sanitizeThemeValue(value)).toBe(value)
  })

  test("rejects stylesheet and markup injection", () => {
    const attacks = [
      "red; background: url(https://attacker.test)",
      "</style><script>alert(1)</script>",
      "url(javascript:alert(1))",
      "expression(alert(1))",
      "@import https://attacker.test/x.css",
      "oklch(0.5 0.2 20)\\0a--background:red",
      'var("--primary")',
      "rgb(1 2 3\n);",
      "red/**/blue",
    ]
    for (const value of attacks) expect(sanitizeThemeValue(value)).toBeNull()
  })

  test("drops unsafe values while keeping safe declarations", () => {
    const css = customThemeCss({
      light: {
        primary: "oklch(0.7 0.2 40)",
        background: "red; } body { display:none",
        unknown: "#fff",
      },
      dark: { primary: "color-mix(in oklch, #fff 30%, #000)" },
    })
    expect(css).toContain("--primary: oklch(0.7 0.2 40);")
    expect(css).toContain("--primary: color-mix(in oklch, #fff 30%, #000);")
    expect(css).not.toContain("display:none")
    expect(css).not.toContain("--unknown")
    expect(sanitizeCustomThemeCss(css)).toBe(css)
  })

  test("rejects forged first-paint cookie stylesheets", () => {
    expect(
      sanitizeCustomThemeCss(
        ':root[data-palette="custom"] {\n  --primary: red;\n}\n</style><script>alert(1)</script>'
      )
    ).toBe("")
    expect(
      sanitizeCustomThemeCss(
        ':root[data-palette="custom"] {\n  --not-a-token: red;\n}'
      )
    ).toBe("")
  })
})

describe("seasonal theme contrast", () => {
  test("light seasonal accents do not overwrite dark palette pairs", async () => {
    const css = await source("../app/theme.css")
    for (const season of [
      "newYear",
      "spring",
      "summer",
      "autumn",
      "halloween",
      "winter",
    ]) {
      expect(css).toContain(`:root:not(.dark)[data-season="${season}"]`)
      expect(css).not.toContain(`:root[data-season="${season}"] {`)
      const darkBlock = css.match(
        new RegExp(`:root\\.dark\\[data-season="${season}"\\] \\{([^}]+)\\}`)
      )?.[1]
      expect(darkBlock).toContain("--primary:")
      expect(darkBlock).toContain("--primary-foreground:")
      expect(darkBlock).toContain("--accent:")
      expect(darkBlock).toContain("--accent-foreground:")
    }
  })
})
