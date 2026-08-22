"use client"

import { useMemo, useState } from "react"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { FullScreenLayer } from "./full-screen-layer"
import { useFlowAdvance } from "./form-flow"

/**
 * Choosing one item out of many.
 *
 * On a laptop the list opens in place, under the field, where the pointer
 * already is. On a phone it takes the screen: the search box sits at the top
 * where the keyboard pushes it, every row is a full-width target, and the back
 * gesture cancels the choice rather than the form. Neither is a modal over the
 * fields, which is the shape that fails on both.
 */

export interface PickerOption {
  value: string
  label: string
  /** Nesting level, drawn as indentation. */
  depth?: number
  hint?: string
  disabled?: boolean
  /** Extra text matched when searching. */
  keywords?: string
}

export function PickerField({
  label,
  description,
  error,
  required,
  options,
  value,
  onValueChange,
  placeholder,
  emptyHint,
  searchable = true,
  layout = "field",
  advanceOnSelect = false,
}: {
  label: string
  description?: string
  error?: string
  required?: boolean
  options: PickerOption[]
  value: string | null
  onValueChange: (value: string) => void
  placeholder?: string
  emptyHint?: string
  searchable?: boolean
  /**
   * `"page"` when the choice *is* the screen — the list is simply there,
   * scrollable, with nothing to open first. That is the right shape for a step
   * whose only job is picking one thing, and it is one tap shorter than any
   * arrangement that starts closed.
   */
  layout?: "field" | "page"
  /**
   * When choosing is all the step asks, the choice moves the flow on by
   * itself — tapping a row and then "Continue" is the same tap twice. Only
   * acts inside a phone flow; a laptop shows every step and stays put.
   */
  advanceOnSelect?: boolean
}) {
  const t = useExtracted()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const wide = useMediaQuery("(min-width: 768px)")
  const flowAdvance = useFlowAdvance()

  // After the commit, not during the tap: the flow's validation reads the
  // form's state, and the state this very tap sets has not landed yet.
  const advanceSoon = () => {
    if (!advanceOnSelect) return
    window.setTimeout(flowAdvance, 0)
  }

  const selected = options.find((option) => option.value === value)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) =>
      `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(needle)
    )
  }, [options, query])

  const close = () => {
    setOpen(false)
    setQuery("")
  }

  const choose = (option: PickerOption) => {
    haptic("selection")
    onValueChange(option.value)
    close()
    advanceSoon()
  }

  const list = (
    <List
      options={filtered}
      value={value}
      emptyHint={emptyHint ?? t("Nothing matches.")}
      onChoose={choose}
    />
  )

  const searchBox = (focus: boolean) => (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("Search…")}
        className="h-(--control-h-search) pl-9"
        autoFocus={focus}
      />
    </div>
  )

  const showSearch = searchable && options.length > 7

  if (layout === "page") {
    return (
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </FieldLabel>

        {/* Nothing autofocuses: arriving on a step with the keyboard already
            up hides the list this step exists to show. */}
        {showSearch ? searchBox(false) : null}

        <div
          className={cn(
            "overflow-hidden rounded-xl border bg-card",
            // The step's own page does the scrolling on a phone. On a laptop
            // the form is one long screen, so the list is capped instead.
            "md:max-h-80 md:overflow-y-auto md:overscroll-contain",
            error && "border-destructive"
          )}
        >
          <List
            options={filtered}
            value={value}
            emptyHint={emptyHint ?? t("Nothing matches.")}
            onChoose={(option) => {
              haptic("selection")
              onValueChange(option.value)
              advanceSoon()
            }}
          />
        </div>

        {description && !error ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
    )
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </FieldLabel>

      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card transition-colors",
          error && "border-destructive"
        )}
      >
        <button
          type="button"
          onClick={() => {
            haptic("selection")
            setOpen((current) => !current)
          }}
          aria-expanded={open}
          className="flex min-h-12 w-full items-center gap-2 px-3 py-2.5 text-left md:min-h-11"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              selected ? "" : "text-muted-foreground"
            )}
          >
            {selected?.label ?? placeholder ?? t("Choose…")}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && wide && "rotate-180"
            )}
          />
        </button>

        {open && wide ? (
          <div className="border-t">
            {showSearch ? (
              <div className="border-b p-2">{searchBox(true)}</div>
            ) : null}
            <div className="max-h-72 overflow-y-auto overscroll-contain">
              {list}
            </div>
          </div>
        ) : null}
      </div>

      {open && !wide ? (
        <FullScreenLayer open onClose={close} title={label}>
          {showSearch ? (
            <div className="sticky top-0 z-10 border-b bg-background p-3">
              {searchBox(true)}
            </div>
          ) : null}
          <div className="pb-4">{list}</div>
        </FullScreenLayer>
      ) : null}

      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

function List({
  options,
  value,
  emptyHint,
  onChoose,
}: {
  options: PickerOption[]
  value: string | null
  emptyHint: string
  onChoose: (option: PickerOption) => void
}) {
  if (options.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        {emptyHint}
      </p>
    )
  }

  return (
    <div className="p-1.5">
      {options.map((option) => {
        const isSelected = option.value === value
        const indent = `${0.625 + (option.depth ?? 0) * 0.8}rem`

        // An option that cannot be chosen but is still listed is a heading —
        // a category, in this app — so it is drawn as one rather than as a
        // greyed-out row that looks like something went wrong.
        if (option.disabled) {
          return (
            <p
              key={option.value}
              style={{ paddingInlineStart: indent }}
              className="pe-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase first:pt-1"
            >
              {option.label}
            </p>
          )
        }

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChoose(option)}
            style={{ paddingInlineStart: indent }}
            className={cn(
              "flex min-h-12 w-full items-center gap-2 rounded-lg pe-2 text-left text-sm transition-colors md:min-h-10",
              isSelected
                ? "bg-primary/10 font-medium text-primary"
                : "hover:bg-accent active:bg-accent"
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {option.label}
              {option.hint ? (
                <span className="ms-2 text-xs font-normal text-muted-foreground">
                  {option.hint}
                </span>
              ) : null}
            </span>
            {isSelected ? (
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <CheckIcon className="size-3" />
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
