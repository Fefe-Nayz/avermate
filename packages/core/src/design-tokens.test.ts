import { describe, expect, test } from "bun:test";
import {
  RESULT_BAND_IDS,
  THEME_FONT_CHOICES,
  THEME_FONT_STACKS,
  THEME_MODES,
  THEME_PRESETS,
  THEME_RADIUS_SCALE_REM,
  THEME_RESULT_BAND_COLORS,
  THEME_SEASONAL_ACCENTS,
  THEME_SEASON_IDS,
  THEME_TOKEN_NAMES,
} from "./design-tokens";

describe("shared design tokens", () => {
  test("keeps the module portable and JSON-pure", async () => {
    const source = await Bun.file(
      new URL("./design-tokens.ts", import.meta.url),
    ).text();

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain("react-native");
    expect(source).not.toContain("@/lib");
    expect(JSON.parse(JSON.stringify(THEME_PRESETS))).toEqual(THEME_PRESETS);
  });

  test("preserves the pre-extraction Web preset payload exactly", () => {
    const payload = JSON.stringify(THEME_PRESETS);
    const checksum = new Bun.CryptoHasher("sha256")
      .update(payload)
      .digest("hex");

    expect(THEME_PRESETS).toHaveLength(12);
    expect(payload).toHaveLength(20_709);
    expect(checksum).toBe(
      "fd828ee256230c09d14191164141227a2135bd86e3c969ff890fc1262c9a43ed",
    );
  });

  test("defines every semantic token for every preset and mode", () => {
    const expectedTokens = [...THEME_TOKEN_NAMES].sort();
    const ids = new Set<string>();

    for (const preset of THEME_PRESETS) {
      expect(ids.has(preset.id), `duplicate preset ${preset.id}`).toBe(false);
      ids.add(preset.id);

      for (const mode of THEME_MODES) {
        expect(
          Object.keys(preset.palette[mode]).sort(),
          `${preset.id}/${mode}`,
        ).toEqual(expectedTokens);
        for (const value of Object.values(preset.palette[mode])) {
          expect(value.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("covers fonts, result bands, seasons and the radius ladder", () => {
    const fontIds = THEME_FONT_CHOICES.map(({ id }) => id);
    expect(Object.keys(THEME_FONT_STACKS)).toEqual(fontIds);

    for (const preset of THEME_PRESETS) {
      expect(fontIds).toContain(preset.shape.font);
      expect(fontIds).toContain(preset.shape.headingFont);
    }

    for (const mode of THEME_MODES) {
      expect(Object.keys(THEME_RESULT_BAND_COLORS[mode])).toEqual([
        ...RESULT_BAND_IDS,
      ]);
    }

    const concreteSeasons = THEME_SEASON_IDS.filter(
      (season) => season !== "auto" && season !== "none",
    );
    expect(Object.keys(THEME_SEASONAL_ACCENTS)).toEqual(concreteSeasons);

    const radii = Object.values(THEME_RADIUS_SCALE_REM);
    expect(radii).toEqual([...radii].sort((left, right) => left - right));
    expect(new Set(radii).size).toBe(radii.length);
  });
});
