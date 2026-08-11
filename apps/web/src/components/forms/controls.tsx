"use client"

import { useId, useState, type ReactNode } from "react"
import { CalendarIcon, CheckIcon } from "lucide-react"
import { useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"

/**
 * Form controls tuned for a thumb.
 *
 * Every target is at least 44px tall, numeric inputs open the numeric keypad,
 * and choices that would be a `<select>` on desktop are laid out as tappable
 * cards instead — a native select on a phone is a modal you cannot style and
 * cannot preview.
 */

export function TextField({
  label,
  description,
  error,
  required,
  ...props
}: React.ComponentProps<typeof Input> & {
  label: string
  description?: string
  error?: string
}) {
  const id = useId()
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        className="h-11 md:h-9"
        {...props}
      />
      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export function NumberField({
  label,
  description,
  error,
  required,
  suffix,
  value,
  onValueChange,
  min,
  max,
  step = "any",
  placeholder,
}: {
  label: string
  description?: string
  error?: string
  required?: boolean
  suffix?: ReactNode
  value: string
  onValueChange: (value: string) => void
  min?: number
  max?: number
  step?: string | number
  placeholder?: string
}) {
  const id = useId()
  const locale = useLocale()
  // French keyboards produce a comma; accepting only a dot would silently
  // reject half the numbers people type.
  const decimalHint = locale.startsWith("fr") ? "[0-9]*[.,]?[0-9]*" : undefined

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </FieldLabel>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          pattern={decimalHint}
          type="text"
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(event) =>
            onValueChange(event.target.value.replace(",", "."))
          }
          className={cn("numeric h-11 md:h-9", suffix && "pr-12")}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export interface Choice<T extends string> {
  value: T
  label: string
  description?: string
  icon?: ReactNode
}

/** Radio behaviour, card presentation. Works with one hand. */
export function ChoiceField<T extends string>({
  label,
  description,
  choices,
  value,
  onValueChange,
  columns = 1,
}: {
  label?: string
  description?: string
  choices: Array<Choice<T>>
  value: T
  onValueChange: (value: T) => void
  columns?: 1 | 2 | 3
}) {
  return (
    <Field>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <div
        role="radiogroup"
        className={cn(
          "grid gap-2",
          columns === 2 && "grid-cols-2",
          columns === 3 && "grid-cols-3"
        )}
      >
        {choices.map((choice) => {
          const selected = choice.value === value
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                haptic("selection")
                onValueChange(choice.value)
              }}
              className={cn(
                "flex min-h-11 items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/6 ring-1 ring-primary/40"
                  : "border-border bg-card hover:bg-accent/50 active:bg-accent"
              )}
            >
              {choice.icon ? (
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    selected ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {choice.icon}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {choice.label}
                </span>
                {choice.description ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {choice.description}
                  </span>
                ) : null}
              </span>
              {selected ? (
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : null}
            </button>
          )
        })}
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

/**
 * A date, picked from a calendar rather than typed into a native control.
 *
 * `<input type="date">` renders a different widget in every browser, ignores
 * the app's theme entirely, and on desktop drops a Chrome-grey panel in the
 * middle of a designed form. This is the same calendar the rest of the app
 * uses, in a popover, so a date looks like the product it is part of.
 *
 * The value stays an ISO `YYYY-MM-DD` string — the shape every caller and the
 * API already speak — so switching a field over is a one-line change.
 */
export interface SelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

/**
 * A dropdown that belongs to this app rather than to the operating system.
 *
 * A native `<select>` cannot be themed past its border: the open list is drawn
 * by the OS, ignores the colour scheme, cannot show a description or a check,
 * and on desktop plants a grey system menu in the middle of the page. This is
 * the Base UI select, which the app already shipped and used nowhere.
 *
 * The label lookup is explicit on purpose. `Select.Value` renders the *value*
 * unless it is told otherwise, so a select over ids would have displayed the
 * ids — the one mistake that would have been invisible until it shipped.
 */
export function SelectControl({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  invalid,
  id,
  className,
  contentClassName,
  "aria-label": ariaLabel,
}: {
  value: string
  onValueChange: (value: string) => void
  options: readonly SelectOption[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  id?: string
  className?: string
  contentClassName?: string
  "aria-label"?: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        haptic("light")
        onValueChange(String(next ?? ""))
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid ? true : undefined}
        className={cn("h-11 w-full md:h-9", className)}
      >
        <SelectValue placeholder={placeholder}>
          {(current) =>
            options.find((option) => option.value === current)?.label ??
            placeholder ??
            ""
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            <span className="flex flex-col gap-0.5 text-left">
              <span>{option.label}</span>
              {option.description ? (
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The same control, wrapped in the form chrome. */
export function SelectField({
  label,
  description,
  error,
  required,
  className,
  ...control
}: React.ComponentProps<typeof SelectControl> & {
  label: string
  description?: string
  error?: string
  required?: boolean
}) {
  const id = useId()

  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </FieldLabel>
      <SelectControl id={id} invalid={Boolean(error)} {...control} />
      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export function DatePicker({
  id,
  value,
  onValueChange,
  min,
  max,
  disabled,
  invalid,
  placeholder,
  className,
  format: style = "long",
}: {
  id?: string
  /** ISO `YYYY-MM-DD`, or an empty string for no date. */
  value: string
  onValueChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
  format?: "long" | "short"
}) {
  const locale = useLocale()
  const [open, setOpen] = useState(false)

  const selected = parseIsoDate(value)
  const lower = parseIsoDate(min)
  const upper = parseIsoDate(max)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid ? true : undefined}
            className={cn(
              "justify-start gap-2 px-3 font-normal",
              !selected && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {selected
            ? selected.toLocaleDateString(locale, {
                day: "numeric",
                month: style === "long" ? "long" : "short",
                year: "numeric",
              })
            : (placeholder ?? "—")}
        </span>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? lower ?? undefined}
          captionLayout="dropdown"
          startMonth={lower}
          endMonth={upper}
          // Two one-sided matchers rather than one range: a bound that is
          // absent has to disable nothing, not everything.
          disabled={[
            ...(lower ? [{ before: lower }] : []),
            ...(upper ? [{ after: upper }] : []),
          ]}
          onSelect={(next) => {
            if (!next) return
            haptic("light")
            onValueChange(toIsoDate(next))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function DateField({
  label,
  description,
  error,
  required,
  className,
  ...picker
}: React.ComponentProps<typeof DatePicker> & {
  label: string
  description?: string
  error?: string
  required?: boolean
}) {
  const id = useId()

  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </FieldLabel>

      <DatePicker
        id={id}
        invalid={Boolean(error)}
        className="h-11 w-full md:h-9"
        {...picker}
      />

      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

/** `YYYY-MM-DD` in local time — `toISOString` would shift it across midnight. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** Parsed as local midnight, for the same reason. */
export function parseIsoDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return undefined
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** A labelled section inside a form screen. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {title ? (
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
