"use client"

import { useId, useState, type ReactNode } from "react"
import { CalendarIcon, CheckIcon, MinusIcon, PlusIcon } from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
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
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { FullScreenLayer } from "./full-screen-layer"

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
      {/* "Next" rather than "Go" on the software keyboard: inside a flow the
          key moves on, it does not submit. `FormFlow` makes it do that. */}
      <Input
        id={id}
        enterKeyHint="next"
        aria-invalid={error ? true : undefined}
        className="h-12 md:h-9"
        {...props}
      />
      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

/** Decimals the step itself carries, so nudging 0.5 does not print 14.500000001. */
function decimalPlaces(step: number): number {
  return step.toString().split(".")[1]?.length ?? 0
}

/**
 * A number, with the two nudges that make one usable on a phone.
 *
 * Typing "14" is four taps on a numeric keypad that has to be summoned first;
 * "one more than last time" is one tap on a stepper. Both are here, because a
 * result is typed and a weight is adjusted, and a field that only supports one
 * of those makes the other tedious.
 *
 * The `−`/`+` pattern is lifted from openbacktest, retuned to this app's
 * control heights: a comfortable 48px on a phone, the compact 36px on a laptop.
 */
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
  /** Off where a stepper would be noise, e.g. a mark out of 100. */
  stepper = true,
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
  stepper?: boolean
}) {
  const t = useExtracted()
  const id = useId()
  const locale = useLocale()
  // French keyboards produce a comma; accepting only a dot would silently
  // reject half the numbers people type.
  const decimalHint = locale.startsWith("fr") ? "[0-9]*[.,]?[0-9]*" : undefined

  const current = Number.parseFloat(value.replace(",", "."))
  const numeric = Number.isFinite(current)
  const nudge = typeof step === "number" ? step : 1
  const floor = min ?? Number.NEGATIVE_INFINITY
  const ceiling = max ?? Number.POSITIVE_INFINITY

  const adjust = (direction: -1 | 1) => {
    haptic("selection")
    const base = numeric ? current : (min ?? 0)
    const next = Math.min(
      ceiling,
      Math.max(floor, base + direction * nudge)
    )
    onValueChange(next.toFixed(decimalPlaces(nudge)))
  }

  const input = (
    <Input
      id={id}
      inputMode="decimal"
      enterKeyHint="next"
      pattern={decimalHint}
      type="text"
      value={value}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      onChange={(event) => onValueChange(event.target.value.replace(",", "."))}
      className={cn("numeric h-12 md:h-9", suffix && "pr-12")}
    />
  )

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </FieldLabel>

      <ButtonGroup className="w-full">
        <div className="relative min-w-0 flex-1">
          {input}
          {suffix ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </div>
        {/* Desktop only. A phone already offers a numeric keypad, and two
            more targets on a row that often holds three of these fields would
            take the width the number itself needs. */}
        {stepper ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="hidden size-9 shrink-0 md:inline-flex"
              aria-label={t("Decrease {label}", { label })}
              onClick={() => adjust(-1)}
              disabled={numeric && current <= floor}
            >
              <MinusIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="hidden size-9 shrink-0 md:inline-flex"
              aria-label={t("Increase {label}", { label })}
              onClick={() => adjust(1)}
              disabled={numeric && current >= ceiling}
            >
              <PlusIcon className="size-4" />
            </Button>
          </>
        ) : null}
      </ButtonGroup>

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
  columns?: 1 | 2 | 3 | 4
}) {
  return (
    <Field>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <div
        role="radiogroup"
        className={cn(
          "grid gap-2",
          columns === 2 && "grid-cols-2",
          columns === 3 && "grid-cols-3",
          columns === 4 && "grid-cols-2 sm:grid-cols-4"
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
  layout = "field",
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
  /** `"page"` when the date *is* the screen: the calendar is simply open. */
  layout?: "field" | "page"
}) {
  const t = useExtracted()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const wide = useMediaQuery("(min-width: 768px)")

  const selected = parseIsoDate(value)
  const lower = parseIsoDate(min)
  const upper = parseIsoDate(max)

  const allowed = (date: Date) =>
    (!lower || date >= lower) && (!upper || date <= upper)

  const pick = (next: Date) => {
    haptic("light")
    onValueChange(toIsoDate(next))
    setOpen(false)
  }

  const calendarWith = (calendarClassName?: string) => (
    <Calendar
      mode="single"
      className={calendarClassName}
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
        pick(next)
      }}
    />
  )

  /**
   * A month that fills the width it is given.
   *
   * The default cell is 1.75rem, which on a phone draws a small square
   * calendar afloat in a card. Raising the floor and letting the cells
   * distribute gives the same edge-to-edge month the grades page has — days
   * stay square because the cell is, so the grid grows with the screen
   * instead of leaving a margin around itself.
   */
  const wideCalendar = calendarWith(
    "w-full p-3 [--cell-size:--spacing(10)] sm:[--cell-size:--spacing(11)]"
  )

  const label = selected
    ? selected.toLocaleDateString(locale, {
        day: "numeric",
        month: style === "long" ? "long" : "short",
        year: "numeric",
      })
    : (placeholder ?? "—")

  // The dates people actually reach for, as one tap rather than a month of
  // hunting. Kept beside the calendar rather than replacing it, because
  // "last Tuesday" is a scan and "today" is a reflex.
  const shortcuts = (
    <div className="flex flex-wrap gap-2">
      {relativeDays().map((option) => {
        const date = option.date
        if (!allowed(date)) return null
        const isSelected =
          selected !== undefined && toIsoDate(date) === toIsoDate(selected)
        return (
          <button
            key={option.offset}
            type="button"
            onClick={() => pick(date)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm transition-colors active:bg-accent",
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card"
            )}
          >
            {option.offset === 0
              ? t("Today")
              : option.offset === -1
                ? t("Yesterday")
                : t("Tomorrow")}
          </button>
        )
      })}
    </div>
  )

  // When the date is the whole screen there is nothing to open: the calendar
  // is the screen. Same rule as the subject list.
  if (layout === "page" && !wide) {
    return (
      <div className="flex flex-col gap-4">
        {shortcuts}
        <div className="overflow-hidden rounded-xl border bg-card">
          {wideCalendar}
        </div>
      </div>
    )
  }

  if (!wide) {
    return (
      <>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          onClick={() => {
            haptic("selection")
            setOpen(true)
          }}
          className={cn(
            "flex min-h-12 w-full items-center gap-2 rounded-md border bg-transparent px-3 text-left text-sm shadow-xs disabled:opacity-50 aria-invalid:border-destructive",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </button>

        <FullScreenLayer
          open={open}
          onClose={() => setOpen(false)}
          title={t("Pick a date")}
          description={selected ? label : undefined}
        >
          <div className="flex flex-col gap-4 p-4">
            {shortcuts}
            <div className="overflow-hidden rounded-xl border bg-card">
              {wideCalendar}
            </div>
          </div>
        </FullScreenLayer>
      </>
    )
  }

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
        <span className="truncate">{label}</span>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        {calendarWith()}
      </PopoverContent>
    </Popover>
  )
}

/** Yesterday through the next few days, for the taps that cover most grades. */
function relativeDays(): Array<{ offset: number; date: Date }> {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return [-1, 0, 1].map((offset) => {
    const date = new Date(today)
    date.setDate(date.getDate() + offset)
    return { offset, date }
  })
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

/**
 * A moment: the app's calendar, plus a time.
 *
 * `<input type="datetime-local">` is the last native control left in the
 * admin, and it is the worst of them — every browser draws a different widget,
 * Chrome plants a grey system panel mid-form, and Firefox on Linux gives you
 * three spinboxes. The date half is the same popover calendar the rest of the
 * app uses; the time half stays a plain `time` input, which is a small,
 * consistently rendered field rather than an overlay, and typing `09:30` in it
 * is genuinely the fastest way to set a time.
 *
 * The value stays a `YYYY-MM-DDTHH:mm` string — exactly what the native input
 * produced and what the API already accepts — so nothing downstream changes.
 */
export function DateTimePicker({
  id,
  value,
  onValueChange,
  min,
  max,
  disabled,
  invalid,
  placeholder,
  className,
}: {
  id?: string
  /** `YYYY-MM-DDTHH:mm`, or an empty string for no moment. */
  value: string
  onValueChange: (value: string) => void
  /** Lower bound, same shape. Only its date part restricts the calendar. */
  min?: string
  max?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
}) {
  const t = useExtracted()
  const [datePart = "", timePart = ""] = value ? value.split("T") : []

  const commit = (nextDate: string, nextTime: string) => {
    if (!nextDate) return onValueChange("")
    // A date with no time is midnight — the same assumption the native control
    // makes, and the one that keeps "starts on the 3rd" meaning the whole day.
    onValueChange(`${nextDate}T${nextTime || "00:00"}`)
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <DatePicker
        id={id}
        value={datePart}
        onValueChange={(next) => commit(next, timePart)}
        min={min ? min.split("T")[0] : undefined}
        max={max ? max.split("T")[0] : undefined}
        disabled={disabled}
        invalid={invalid}
        placeholder={placeholder}
        format="short"
        className="h-11 min-w-0 flex-1 md:h-9"
      />
      <Input
        type="time"
        aria-label={t("Time")}
        value={timePart}
        disabled={disabled || !datePart}
        onChange={(event) => commit(datePart, event.target.value)}
        className="h-11 w-28 shrink-0 md:h-9"
      />
    </div>
  )
}

export function DateTimeField({
  label,
  description,
  error,
  required,
  className,
  ...picker
}: React.ComponentProps<typeof DateTimePicker> & {
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

      <DateTimePicker id={id} invalid={Boolean(error)} {...picker} />

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
