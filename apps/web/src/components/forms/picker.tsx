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
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"

/**
 * Choosing one item out of many, without a modal.
 *
 * Collapsed it is a single row showing what is selected; open it becomes a
 * searchable list in place. Nothing overlays the form, so the keyboard never
 * covers the thing you are picking and a back gesture still means "leave the
 * screen" rather than "close the layer you forgot was open".
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

  const selected = options.find((option) => option.value === value)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) =>
      `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(needle)
    )
  }, [options, query])

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
          className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left"
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
              open && "rotate-180"
            )}
          />
        </button>

        {open ? (
          <div className="border-t">
            {searchable && options.length > 7 ? (
              <div className="relative border-b p-2">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Search…")}
                  className="h-10 pl-9"
                  autoFocus
                />
              </div>
            ) : null}

            <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {emptyHint ?? t("Nothing matches.")}
                </p>
              ) : (
                filtered.map((option) => {
                  const isSelected = option.value === value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={option.disabled}
                      onClick={() => {
                        haptic("selection")
                        onValueChange(option.value)
                        setOpen(false)
                        setQuery("")
                      }}
                      style={{
                        paddingInlineStart: `${0.75 + (option.depth ?? 0) * 0.85}rem`,
                      }}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-2 pe-3 text-left text-sm transition-colors",
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
                })
              )}
            </div>
          </div>
        ) : null}
      </div>

      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}
