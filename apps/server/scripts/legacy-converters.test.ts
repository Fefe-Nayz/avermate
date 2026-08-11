import { describe, expect, test } from "bun:test";
import {
  legacyTokenName,
  migrateLegacySeason,
  migrateLegacyTheme,
} from "./legacy-converters";

describe("legacy migration converters", () => {
  test("converts camelCase and numbered theme tokens to CSS names", () => {
    expect(legacyTokenName("primaryForeground")).toBe("primary-foreground");
    expect(legacyTokenName("chart1")).toBe("chart-1");
    expect(legacyTokenName("sidebarPrimaryForeground")).toBe(
      "sidebar-primary-foreground",
    );
  });

  test("preserves distinct palettes, typography and shape", () => {
    const migrated = migrateLegacyTheme({
      customTheme: JSON.stringify({
        enabled: true,
        radius: 1.25,
        fontSans: "'Source Code Pro', monospace",
        light: { background: "white", primaryForeground: "black" },
        dark: { background: "black", chart1: "cyan" },
      }),
    });

    expect(migrated.themePreset).toBe("custom");
    expect(migrated.customTheme.light).toEqual({
      background: "white",
      "primary-foreground": "black",
    });
    expect(migrated.customTheme.dark).toEqual({
      background: "black",
      "chart-1": "cyan",
    });
    expect(migrated.themeShape).toEqual({
      font: "'Source Code Pro', monospace",
      headingFont: "inherit",
      radius: 1.25,
    });
  });

  test("carries Mokattam entitlement and celebration state", () => {
    const migrated = migrateLegacyTheme({
      mokattamThemeAvailable: 1,
      mokattamThemeEnabled: 1,
      mokattamThemeCelebrationSeenAt: 1_700_000_000,
    });
    expect(migrated.themePreset).toBe("mokattam");
    expect(migrated.unlockedThemes).toEqual(["mokattam"]);
    expect(migrated.seenCelebrations).toEqual(["mokattam"]);
  });

  test("maps the renamed April Fools season", () => {
    expect(migrateLegacySeason("april-fools")).toBe("aprilFools");
    expect(migrateLegacySeason("halloween")).toBe("halloween");
  });
});
