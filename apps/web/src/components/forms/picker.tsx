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
}) {
  const t = useExtracted()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const wide = useMediaQuery("(min-width: 768px)")

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
  }

  const list = (
    <List
      options={filtered}
      value={value}
      emptyHint={emptyHint ?? t("Nothing matches.")}
      onChoose={choose}
    />
  )

  const search = (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("Search…")}
        className="h-11 pl-9 md:h-10"
        autoFocus
      />
    </div>
  )

  const showSearch = searchable && options.length > 7

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
            {showSearch ? <div className="border-b p-2">{search}</div> : null}
            <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
              {list}
            </div>
          </div>
        ) : null}
      </div>

      {open && !wide ? (
        <FullScreenLayer open onClose={close} title={label}>
          {showSearch ? (
            <div className="sticky top-0 z-10 border-b bg-background p-3">
              {search}
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
    <>
      {options.map((option) => {
        const isSelected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            onClick={() => onChoose(option)}
            style={{
              paddingInlineStart: `${0.75 + (option.depth ?? 0) * 0.85}rem`,
            }}
            className={cn(
              "flex min-h-13 w-full items-center gap-2 pe-3 text-left text-sm transition-colors md:min-h-11",
              option.disabled
                ? "cursor-not-allowed text-muted-foreground/60"
                : "hover:bg-accent active:bg-accent",
              isSelected && "bg-primary/8 font-medium"
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {option.label}
              {option.hint ? (
                <span className="ms-2 text-xs text-muted-foreground">
                  {option.hint}
                </span>
              ) : null}
            </span>
            {isSelected ? (
              <CheckIcon className="size-4 shrink-0 text-primary" />
            ) : null}
          </button>
        )
      })}
    </>
  )
}
