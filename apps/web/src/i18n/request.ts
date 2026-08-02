import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isAppLocale, LOCALE_COOKIE } from "./config";

/**
 * Locale resolution, in order: the cookie the settings screen writes, then the
 * browser's own preference, then French. No locale segment in the URL — a
 * shared link should open in the reader's language, not the sender's.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const stored = store.get(LOCALE_COOKIE)?.value;

  let locale = isAppLocale(stored) ? stored : null;

  if (!locale) {
    const accept = (await headers()).get("accept-language") ?? "";
    locale = accept.toLowerCase().startsWith("en") ? "en" : defaultLocale;
  }

  // Extraction writes an empty string for every key it has not seen translated
  // yet. Falling back to the source locale means a new screen ships readable in
  // both languages instead of blank in one of them.
  const source = (await import("../../messages/en.json")).default as Record<
    string,
    string
  >;
  const target =
    locale === "en"
      ? source
      : ((await import(`../../messages/${locale}.json`)).default as Record<
          string,
          string
        >);

  const messages: Record<string, string> = { ...source };
  for (const [key, value] of Object.entries(target)) {
    if (value) messages[key] = value;
  }

  return { locale, messages };
});
