import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The French catalogue, checked against the source rather than trusted.
 *
 * A missing translation on native degrades to English silently — there is no
 * build step to catch it and no console warning to read on a phone. So the
 * check lives here: every `t("…")` in the app must have an entry, no entry may
 * be dead, and the placeholders on both sides must agree.
 *
 * The source is read as text on purpose: importing `i18n.ts` would pull in
 * `expo-localization`, which does not exist outside a native runtime.
 */

const root = join(import.meta.dir, "..");

function sources(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

function usedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  const patterns = [
    /\bt\(\s*"((?:\\.|[^"\\])*)"/g,
    /\bt\(\s*'((?:\\.|[^'\\])*)'/g,
  ];

  for (const path of [
    ...sources(join(root, "app")),
    ...sources(join(root, "components")),
    ...sources(join(root, "lib")).filter(
      (path) => !path.endsWith(`${join("lib", "i18n.ts")}`),
    ),
  ]) {
    const text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const key = (match[1] as string)
          .replaceAll('\\"', '"')
          .replaceAll("\\'", "'");
        if (!found.has(key)) found.set(key, path);
      }
    }
  }

  // Declarative widget labels are core message-key mappings passed to `t`
  // dynamically, so include the literal catalogue values in this source map.
  const widgetMessages = join(
    root,
    "components",
    "widgets",
    "widget-messages.ts",
  );
  const text = readFileSync(widgetMessages, "utf8");
  const start = text.indexOf("export const WIDGET_MESSAGE_LABELS");
  const end = text.indexOf("\n};", start);
  const body = text.slice(start, end);
  for (const match of body.matchAll(/:\s*"((?:\\.|[^"\\])*)"/g)) {
    const key = (match[1] as string).replaceAll('\\"', '"');
    if (!found.has(key)) found.set(key, widgetMessages);
  }
  return found;
}

/** Entries of the `fr` object, read straight out of the module text. */
function catalogue(): Map<string, string> {
  const text = readFileSync(join(root, "lib", "i18n.ts"), "utf8");
  const start = text.indexOf("const fr: Record<string, string> = {");
  const end = text.indexOf("\n};", start);
  const body = text.slice(start, end);

  const entries = new Map<string, string>();
  const pattern =
    /(?:^|\n)\s*(?:"((?:\\.|[^"\\])*)"|([A-Za-z][A-Za-z0-9]*)):\s*(?:\n\s*)?"((?:\\.|[^"\\])*)"/g;

  for (const match of body.matchAll(pattern)) {
    const key = (match[1] ?? match[2] ?? "").replaceAll('\\"', '"');
    entries.set(key, (match[3] as string).replaceAll('\\"', '"'));
  }
  return entries;
}

const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("french catalogue", () => {
  const used = usedKeys();
  const french = catalogue();

  test("has an entry for every string the app renders", () => {
    const missing = [...used.keys()].filter((key) => !french.has(key));
    expect(missing).toEqual([]);
  });

  test("has no entry the app never renders", () => {
    const orphaned = [...french.keys()].filter((key) => !used.has(key));
    expect(orphaned).toEqual([]);
  });

  test("keeps the same placeholders on both sides", () => {
    const mismatched = [...french.entries()]
      .filter(
        ([key, value]) =>
          placeholders(key).join() !== placeholders(value).join(),
      )
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  test("translates enough to be worth having", () => {
    expect(french.size).toBeGreaterThan(150);
  });
});
