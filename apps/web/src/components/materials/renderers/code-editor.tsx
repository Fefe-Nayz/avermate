"use client"

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react"
import { basicSetup } from "codemirror"
import { redo, undo } from "@codemirror/commands"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { cn } from "@/lib/utils"

/**
 * The editor commands a toolbar needs.
 *
 * CodeMirror keeps its own undo history and binds it internally, so there is
 * nothing for a button outside it to call — the host stores a handle here
 * instead. `goToLine` is the one that earns this seam: it is what turns a
 * compiler error into something you can click.
 */
export interface CodeEditorApi {
  undo(): void
  redo(): void
  focus(): void
  /** Put the caret on a 1-based line and scroll it into view. */
  goToLine(line: number): void
}

/**
 * A real code editor, themed like the rest of the app.
 *
 * Built on `EditorView` directly rather than on a React wrapper, because the
 * project already integrates CodeMirror that way in the Markdown editor and one
 * codebase should have one answer to "how do we mount CodeMirror". The wrapper
 * would also have brought its own editor theme, and an editor that stays dark
 * in a light app is a hole in the page — here the backgrounds are transparent
 * and every colour comes from the app's own tokens, so both themes work.
 *
 * Deliberately not a `<textarea>`: a LaTeX source without line numbers, without
 * bracket matching and without a caret you can put on line 42 is a source you
 * edit by counting.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  ariaLabel,
  readOnly,
  apiRef,
  onSubmit,
  className,
}: {
  value: string
  onChange: (value: string) => void
  /** The language mode; the caller owns it so this file stays format-agnostic. */
  language: Extension
  ariaLabel: string
  readOnly?: boolean
  apiRef?: RefObject<CodeEditorApi | null>
  /** Ctrl/Cmd+S and Ctrl/Cmd+Enter, the two things every editor binds to "run". */
  onSubmit?: () => void
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Held in refs so a new callback on every render does not tear the editor
  // down and rebuild it, which would lose the selection and the undo history.
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    onChangeRef.current = onChange
    onSubmitRef.current = onSubmit
  }, [onChange, onSubmit])

  useEffect(() => {
    if (!host.current) return
    const instance = new EditorView({
      doc: value,
      parent: host.current,
      extensions: [
        basicSetup,
        language,
        EditorView.lineWrapping,
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          spellcheck: "false",
          autocapitalize: "off",
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
            fontSize: "0.8rem",
            height: "100%",
          },
          ".cm-content": {
            caretColor: "var(--primary)",
            fontFamily: "var(--app-font-mono), monospace",
            lineHeight: "1.6",
          },
          ".cm-focused": { outline: "none" },
          ".cm-gutters": {
            backgroundColor: "transparent",
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
    // The controlled value is synchronised below rather than here: rebuilding
    // the editor on every keystroke is what a `value` dependency would mean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel, language, readOnly])

  useEffect(() => {
    const instance = view.current
    if (!instance || instance.state.doc.toString() === value) return
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: value },
    })
  }, [value])

  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      undo: () => {
        const instance = view.current
        if (!instance) return
        undo(instance)
        instance.focus()
      },
      redo: () => {
        const instance = view.current
        if (!instance) return
        redo(instance)
        instance.focus()
      },
      focus: () => view.current?.focus(),
      goToLine: (line) => {
        const instance = view.current
        if (!instance) return
        // A compiler can name a line past the end of a document that has been
        // edited since it ran; clamping beats throwing.
        const target = Math.min(Math.max(line, 1), instance.state.doc.lines)
        const position = instance.state.doc.line(target).from
        instance.dispatch({
          selection: { anchor: position },
          effects: EditorView.scrollIntoView(position, { y: "center" }),
        })
        instance.focus()
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef])

  /**
   * Typing must not reach the app's own shortcuts.
   *
   * Supports binds ctrl+A, ctrl+X and ctrl+V to the file list, and none of
   * those should fire while somebody is writing a document — select-all in an
   * editor selecting four hundred files instead is the kind of bug that only
   * shows up once you have a document open beside a list.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    const accel = event.metaKey || event.ctrlKey
    if (!accel || !onSubmitRef.current) return
    if (event.key !== "s" && event.key !== "Enter") return
    event.preventDefault()
    onSubmitRef.current()
  }

  return (
    <div
      ref={host}
      onKeyDownCapture={onKeyDown}
      className={cn(
        "min-h-0 flex-1 overflow-auto",
        "[&_.cm-editor]:h-full [&_.cm-scroller]:font-mono",
        className
      )}
    />
  )
}
