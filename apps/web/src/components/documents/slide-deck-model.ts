/** Storage-compatible separator used by the server and PPTX exporter. */
export const SLIDE_SEPARATOR = "\n---\n"
export const SLIDE_DECK_MAX_SLIDES = 100

/**
 * Strip CommonMark quote and list containers before inspecting a fence.
 * A fence can legally open as the first block of a list item (`- ```md`),
 * and separators inside it must remain part of the slide body.
 */
function withoutMarkdownContainers(line: string): string {
  let remainder = line
  while (true) {
    const quote = /^ {0,3}>[\t ]?/.exec(remainder)
    if (quote) {
      remainder = remainder.slice(quote[0].length)
      continue
    }
    const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[\t ]+/.exec(remainder)
    if (list) {
      remainder = remainder.slice(list[0].length)
      continue
    }
    break
  }
  return remainder.replace(/^ {0,3}/, "")
}

function markdownFenceToken(
  line: string
): { marker: "`" | "~"; length: number; suffix: string } | null {
  const match = /^(`{3,}|~{3,})(.*)$/.exec(withoutMarkdownContainers(line))
  if (!match) return null
  const token = match[1] as string
  const suffix = match[2] as string
  if (token[0] === "`" && suffix.includes("`")) return null
  return {
    marker: token[0] as "`" | "~",
    length: token.length,
    suffix,
  }
}

/**
 * Split thematic-break lines only when they are outside Markdown code fences.
 * Math, horizontal rules inside fences, and the original slide Markdown stay
 * untouched for the shared GFM/KaTeX renderer.
 */
export function splitMarkdownSlides(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const slides: string[] = []
  let current: string[] = []
  let fence: { marker: "`" | "~"; length: number } | null = null

  for (const line of lines) {
    const token = markdownFenceToken(line)
    if (token) {
      if (!fence) {
        fence = { marker: token.marker, length: token.length }
      } else if (
        token.marker === fence.marker &&
        token.length >= fence.length &&
        token.suffix.trim() === ""
      ) {
        fence = null
      }
      current.push(line)
      continue
    }

    if (!fence && line.trim() === "---") {
      slides.push(current.join("\n").trim())
      current = []
      continue
    }
    current.push(line)
  }

  slides.push(current.join("\n").trim())
  return slides
}

export function slideDeckIssue(markdown: string): string | null {
  const count = splitMarkdownSlides(markdown).length
  return count > SLIDE_DECK_MAX_SLIDES
    ? `A slide deck can contain at most ${SLIDE_DECK_MAX_SLIDES} slides`
    : null
}
