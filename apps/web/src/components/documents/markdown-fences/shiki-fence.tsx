"use client"

import { useEffect, useState, type CSSProperties } from "react"
import { useTheme } from "next-themes"
import { MAX_HIGHLIGHT_SOURCE_BYTES } from "./model"
import { FenceStatus } from "./fence-frame"

interface HighlightToken {
  content: string
  color?: string
  bgColor?: string
  fontStyle?: number
}

interface HighlightResult {
  tokens: HighlightToken[][]
  fg?: string
  bg?: string
}

type HighlightState =
  | {
      status: "ready"
      source: string
      language: string
      theme: string
      result: HighlightResult
    }
  | {
      status: "error"
      source: string
      language: string
      theme: string
    }

function sourceBytes(source: string): number {
  return new TextEncoder().encode(source).byteLength
}

function tokenStyle(token: HighlightToken): CSSProperties {
  const fontStyle = token.fontStyle ?? 0
  return {
    color: token.color,
    backgroundColor: token.bgColor,
    fontStyle: fontStyle & 1 ? "italic" : undefined,
    fontWeight: fontStyle & 2 ? 700 : undefined,
    textDecoration: fontStyle & 4 ? "underline" : undefined,
  }
}

/** Syntax highlighting is imported only for a document that has a code fence. */
export function ShikiFence({
  source,
  language,
}: {
  source: string
  language: string
}) {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "github-dark" : "github-light"
  const [state, setState] = useState<HighlightState | null>(null)
  const tooLarge = sourceBytes(source) > MAX_HIGHLIGHT_SOURCE_BYTES

  useEffect(() => {
    if (tooLarge) return
    let cancelled = false
    void (async () => {
      try {
        const shiki = await import("shiki/bundle/web")
        const normalized = language.trim().toLowerCase()
        const aliases = shiki.bundledLanguagesAlias as Record<string, unknown>
        const languages = shiki.bundledLanguages as Record<string, unknown>
        const selected =
          normalized in languages || normalized in aliases ? normalized : "text"
        const highlight = shiki.codeToTokens as unknown as (
          code: string,
          options: {
            lang: string
            theme: string
            tokenizeMaxLineLength: number
            tokenizeTimeLimit: number
          }
        ) => Promise<HighlightResult>
        const highlighted = await highlight(source, {
          lang: selected,
          theme,
          tokenizeMaxLineLength: 10_000,
          tokenizeTimeLimit: 250,
        })
        if (!cancelled) {
          setState({
            status: "ready",
            source,
            language,
            theme,
            result: highlighted,
          })
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error", source, language, theme })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [language, source, theme, tooLarge])

  const current =
    state?.source === source &&
    state.language === language &&
    state.theme === theme
      ? state
      : null

  if (tooLarge) {
    return (
      <FenceStatus error>
        This code block is too large to highlight safely.
      </FenceStatus>
    )
  }
  if (current?.status === "error") {
    return (
      <pre className="max-w-full overflow-auto rounded-lg border p-4 font-mono text-xs leading-relaxed">
        <code>{source}</code>
      </pre>
    )
  }
  if (current?.status !== "ready") {
    return <FenceStatus>Highlighting code…</FenceStatus>
  }
  const { result } = current

  return (
    <pre
      className="shiki-fence max-w-full overflow-auto rounded-lg border p-4 font-mono text-xs leading-relaxed"
      style={{ color: result.fg, backgroundColor: result.bg }}
    >
      <code>
        {result.tokens.map((line, lineIndex) => (
          <span key={lineIndex} className="block min-h-[1lh]">
            {line.map((token, tokenIndex) => (
              <span key={tokenIndex} style={tokenStyle(token)}>
                {token.content}
              </span>
            ))}
          </span>
        ))}
      </code>
    </pre>
  )
}
