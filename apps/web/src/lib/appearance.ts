import type { Palette } from "./theme";

/**
 * Appearance that has to be right on the very first paint.
 *
 * The account's preferences live on the server, but waiting for a round trip
 * would mean rendering the default theme and then swapping it — a flash on
 * every navigation. So the few values that affect layout and colour are
 * mirrored into a cookie the server layout can read synchronously.
 */

export const APPEARANCE_COOKIE = "avermate-appearance";

export interface Appearance {
  palette: Palette | "custom" | "mokattam";
  /** Inline CSS for the custom palette, already serialised. */
  customCss: string;
  font: string;
  headingFont: string;
  radius: number;
  reduceMotion: boolean;
  season: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  palette: "default",
  customCss: "",
  font: "inter",
  headingFont: "inherit",
  radius: 0.625,
  reduceMotion: false,
  season: "none",
};

export function parseAppearance(raw: string | undefined): Appearance {
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<Appearance>;
    return { ...DEFAULT_APPEARANCE, ...parsed };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearanceCookie(appearance: Appearance): void {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(appearance));
  // A year, so a returning visitor still lands in their own theme.
  document.cookie = `${APPEARANCE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
}
