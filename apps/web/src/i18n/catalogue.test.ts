import { describe, expect, test } from "bun:test"
import en from "../../messages/en.json"
import fr from "../../messages/fr.json"

/**
 * Extraction adds every new source string to `en.json` and mirrors it into
 * `fr.json` as an empty value. Without this test the French build ships those
 * blanks silently — the request config falls back to English, so nothing looks
 * broken until a French reader finds an English sentence.
 */

const source = en as Record<string, string>
const target = fr as Record<string, string>

/**
 * The arguments a message expects, e.g. `count` in "{count} results".
 *
 * An argument name is followed by `}` or `,` — the second being an ICU format such as
 * `{count, plural, ...}`. The words *inside* a plural's branches are ordinary
 * translatable text and are deliberately not arguments: matching every `{word` would
 * read "{No items}" as a placeholder called `No`, and then demand that French spell it
 * the same way.
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*(\w+)\s*[},]/g)]
    .map((match) => match[1] as string)
    .sort()
}

describe("message catalogues", () => {
  test("every English string has a French one", () => {
    const missing = Object.keys(source).filter((key) => !target[key]?.trim())
    expect(missing.map((key) => `${key}: ${source[key]}`)).toEqual([])
  })

  test("no French string is left over from a deleted screen", () => {
    const extra = Object.keys(target).filter((key) => !(key in source))
    expect(extra).toEqual([])
  })

  test("placeholders survive translation", () => {
    const broken = Object.keys(source)
      .filter((key) => target[key])
      .filter(
        (key) =>
          placeholders(source[key] as string).join(",") !==
          placeholders(target[key] as string).join(",")
      )
    expect(
      broken.map((key) => `${key}: ${source[key]} → ${target[key]}`)
    ).toEqual([])
  })
})
