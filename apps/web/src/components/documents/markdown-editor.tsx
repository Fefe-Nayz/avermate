"use client"

import { useEffect, useRef } from "react"
import { basicSetup } from "codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { EditorView } from "@codemirror/view"

export interface MarkdownInsertRequest {
  id: number
  text: string
}

export function MarkdownEditor({
  value,
  onChange,
  ariaLabel,
  insertRequest,
}: {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  insertRequest: MarkdownInsertRequest | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const lastInsertion = useRef<number | null>(null)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!host.current) return
    const instance = new EditorView({
      doc: value,
      parent: host.current,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          autocapitalize: "sentences",
          spellcheck: "true",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          "&": {
            backgroundColor: "transparent",
            color: "var(--foreground)",
            fontSize: "0.9rem",
            height: "100%",
          },
          ".cm-content": {
            caretColor: "var(--primary)",
            fontFamily: "var(--app-font-mono), monospace",
            lineHeight: "1.65",
            minHeight: "30rem",
            padding: "1rem",
          },
          ".cm-focused": { outline: "none" },
          ".cm-gutters": {
            backgroundColor:
              "color-mix(in oklab, var(--muted) 45%, transparent)",
            borderRight: "1px solid var(--border)",
            color: "var(--muted-foreground)",
          },
          ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor:
              "color-mix(in oklab, var(--primary) 5%, transparent)",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor:
              "color-mix(in oklab, var(--primary) 22%, transparent)",
          },
        }),
      ],
    })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
    // The controlled value is synchronized below without rebuilding CodeMirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel])

  useEffect(() => {
    const instance = view.current
    if (!instance || instance.state.doc.toString() === value) return
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: value },
    })
  }, [value])

  useEffect(() => {
    const instance = view.current
    if (
      !instance ||
      !insertRequest ||
      lastInsertion.current === insertRequest.id
    ) {
      return
    }
    lastInsertion.current = insertRequest.id
    const selection = instance.state.selection.main
    instance.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: insertRequest.text,
      },
      selection: { anchor: selection.from + insertRequest.text.length },
      scrollIntoView: true,
    })
    instance.focus()
  }, [insertRequest])

  return <div ref={host} className="h-full min-h-[30rem] overflow-hidden" />
}
