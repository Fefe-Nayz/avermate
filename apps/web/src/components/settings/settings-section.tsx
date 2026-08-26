"use client"

import { cloneElement, isValidElement, useId } from "react"
import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * A titled block of settings. One visual grammar across every settings page.
 *
 * `icon` is optional and worth passing: a page of five identical grey headings
 * is read line by line, where a glyph is recognised, and it lets a section
 * echo the shape the navigation rail uses for the same thing.
 */
export function SettingsSection({
  id,
  title,
  description,
  icon: Icon,
  children,
  className,
  footer,
}: {
  id?: string
  title: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  children: ReactNode
  className?: string
  footer?: ReactNode
}) {
  return (
    <section
      id={id}
      // `settings-section` is what the `:target` ring in app.css hooks onto, so a
      // settings-search result lands on a section that says "this one".
      className={cn(
        "settings-section scroll-mt-4 rounded-xl border bg-card",
        className
      )}
    >
      <header className="px-4 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {Icon ? (
            <Icon className="size-4 shrink-0 text-muted-foreground" />
          ) : null}
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
      {footer ? (
        <footer className="flex items-center gap-2 border-t px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </section>
  )
}

/** A single labelled row with a control on the trailing edge. */
export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string
  description?: string
  children: ReactNode
  htmlFor?: string
}) {
  /**
   * The control is told which text names it.
   *
   * The row rendered `<label htmlFor={htmlFor}>` beside the control, and not
   * one of the fourteen call sites ever passed `htmlFor` — so every settings
   * switch was announced with no name. Wrapping the control in the label does
   * not fix it either: base-ui renders a `<span role="switch">`, and a span is
   * not labelable, so the label would bind to the hidden checkbox instead.
   * What that switch does read is `aria-labelledby`, so the row hands it the
   * id of its own label text. A caller that already names its control, or that
   * passes `htmlFor` for a genuinely labelable one, is left alone.
   */
  const labelId = useId()
  const control =
    isValidElement<Record<string, unknown>>(children) &&
    !htmlFor &&
    !children.props["aria-label"] &&
    !children.props["aria-labelledby"]
      ? cloneElement(children, { "aria-labelledby": labelId })
      : children

  return (
    <div className="flex min-h-11 items-center gap-4">
      <label htmlFor={htmlFor} className="min-w-0 flex-1">
        <span id={labelId} className="block text-sm">
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </label>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
