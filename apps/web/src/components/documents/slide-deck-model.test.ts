import { describe, expect, test } from "bun:test"
import {
  SLIDE_DECK_MAX_SLIDES,
  SLIDE_SEPARATOR,
  slideDeckIssue,
  splitMarkdownSlides,
} from "./slide-deck-model"

describe("fence-aware slide deck splitting", () => {
  test("splits standard separators and normalizes CRLF without touching math", () => {
    expect(
      splitMarkdownSlides("# One\r\n\r\n$\\int_0^1 x dx$\r\n---\r\n# Two")
    ).toEqual(["# One\n\n$\\int_0^1 x dx$", "# Two"])
  })

  test("does not split a thematic break inside backtick fences", () => {
    const markdown = [
      "# Code",
      "```md",
      "first",
      "---",
      "second",
      "```",
      "---",
      "# Real second slide",
    ].join("\n")
    expect(splitMarkdownSlides(markdown)).toEqual([
      "# Code\n```md\nfirst\n---\nsecond\n```",
      "# Real second slide",
    ])
  })

  test("tracks tilde fences and accepts a longer matching close", () => {
    const markdown = ["~~~~txt", "---", "~~~~~", "---", "After"].join("\n")
    expect(splitMarkdownSlides(markdown)).toEqual([
      "~~~~txt\n---\n~~~~~",
      "After",
    ])
  })

  test("does not let a shorter or different marker close the fence", () => {
    const markdown = [
      "````",
      "~~~",
      "```",
      "---",
      "````",
      "---",
      "Outside",
    ].join("\n")
    expect(splitMarkdownSlides(markdown)).toEqual([
      "````\n~~~\n```\n---\n````",
      "Outside",
    ])
  })

  test("keeps separators inside fences nested in CommonMark containers", () => {
    const markdown = [
      "- ```md",
      "  ---",
      "  ```",
      "> ~~~txt",
      "> ---",
      "> ~~~",
      "---",
      "# Actual second slide",
    ].join("\n")

    expect(splitMarkdownSlides(markdown)).toEqual([
      "- ```md\n  ---\n  ```\n> ~~~txt\n> ---\n> ~~~",
      "# Actual second slide",
    ])
  })

  test("keeps intentional empty slides and enforces the server maximum", () => {
    expect(splitMarkdownSlides(`${SLIDE_SEPARATOR.trim()}\n---\n`)).toEqual([
      "",
      "",
      "",
    ])
    expect(
      slideDeckIssue(
        Array.from({ length: SLIDE_DECK_MAX_SLIDES + 1 }, (_, index) =>
          String(index)
        ).join(SLIDE_SEPARATOR)
      )
    ).toBe(`A slide deck can contain at most ${SLIDE_DECK_MAX_SLIDES} slides`)
  })
})
