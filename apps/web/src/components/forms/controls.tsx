"use client"

import {
  useId,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react"
import { CARD_ACCENTS } from "@/components/cards/card-accent"
import { useExtracted, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Calendar } from "@/components/ui/calendar"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
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
import { MonthPagerCalendar } from "./month-pager-calendar"

/**
 * Form controls tuned for a thumb.
 *
 * Controls inherit pointer-aware density from the shared primitives; custom
 * touch targets remain at least 44px tall. Numeric inputs open the numeric
 * keypad, and choices that would be a `<select>` on desktop are laid out as
 * tappable cards instead — a native select on a phone is a modal you cannot
 * style and cannot preview.
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
        className="h-(--control-h-comfortable)"
        {...props}
      />
      {description && !error ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

function decimalPlaces(value: number): number {
  return value.toString().split(".")[1]?.length ?? 0
}

/**
 * A number, with a stepper.
 *
 * This is openbacktest's `NumberStepperField`: the input flexes and the unit
 * never does, the `−`/`+` hold their size, and the whole control keeps a floor
 * so a narrow column shrinks the input rather than collapsing it to nothing.
 * Every part inherits the same pointer-aware control height, keeping the row
 * level without guessing input modality from viewport width.
 */
export function NumberField({
  label,
  description,
  error,
  required,
  suffix,
  prefix,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  placeholder,
  disabled = false,
  /** Off where the number is typed and never nudged. */
  stepper = true,
}: {
  label: string
  description?: string
  error?: string
  required?: boolean
  suffix?: string
  prefix?: string
  value: string
  onValueChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  disabled?: boolean
  stepper?: boolean
}) {
  const t = useExtracted()
  const id = useId()
  const locale = useLocale()
  // French keyboards produce a comma; accepting only a dot would silently
  // reject half the numbers people type.
  const decimalHint = locale.startsWith("fr") ? "[0-9]*[.,]?[0-9]*" : undefined

  const numericValue = Number(value)
  const isNumeric = value.trim() !== "" && Number.isFinite(numericValue)
  const floor = min ?? Number.NEGATIVE_INFINITY
  const ceiling = max ?? Number.MAX_SAFE_INTEGER

  const adjust = (direction: -1 | 1) => {
    haptic("selection")
    const base = isNumeric ? numericValue : (min ?? 0)
    const next = Math.min(ceiling, Math.max(floor, base + direction * step))
    onValueChange(next.toFixed(decimalPlaces(step)).replace(/\.0+$/, ""))
  }

  const inputProps = {
    id,
    value,
    placeholder,
    disabled,
    inputMode: (step % 1 === 0 ? "numeric" : "decimal") as
      "numeric" | "decimal",
    enterKeyHint: "next" as const,
    pattern: decimalHint,
    type: "text",
    "aria-invalid": error ? (true as const) : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      onValueChange(event.target.value.replace(",", ".")),
  }

  return (
    <Field
      data-invalid={error ? true : undefined}
      data-disabled={disabled || undefined}
    >
      <FieldContent className="min-w-0">
        <FieldLabel htmlFor={id}>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </FieldLabel>
        {description && !error ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldContent>

      <ButtonGroup className="w-full">
        {prefix || suffix ? (
          <InputGroup className="h-(--control-h-comfortable) min-w-24 flex-1">
            {prefix ? (
              <InputGroupAddon className="shrink-0">
                <InputGroupText>{prefix}</InputGroupText>
              </InputGroupAddon>
            ) : null}
            <InputGroupInput
              {...inputProps}
              className="numeric min-w-0 grow basis-16"
            />
            {suffix ? (
              <InputGroupAddon align="inline-end" className="shrink-0">
                <InputGroupText>{suffix}</InputGroupText>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        ) : (
          <Input
            {...inputProps}
            className="numeric h-(--control-h-comfortable) min-w-16 grow basis-16"
          />
        )}
        {stepper ? (
          <>
            <Button
              variant="outline"
              size="icon"
              type="button"
              className="size-(--control-h-comfortable) shrink-0"
              aria-label={t("Decrease {label}", { label })}
              onClick={() => adjust(-1)}
              disabled={disabled || (isNumeric && numericValue <= floor)}
            >
              <MinusIcon />
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              className="size-(--control-h-comfortable) shrink-0"
              aria-label={t("Increase {label}", { label })}
              onClick={() => adjust(1)}
              disabled={disabled || (isNumeric && numericValue >= ceiling)}
            >
              <PlusIcon />
            </Button>
          </>
        ) : null}
      </ButtonGroup>
    </Field>
  )
}

export interface Choice<T extends string> {
  value: T
  label: string
  description?: string
  icon?: ReactNode
  disabled?: boolean
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
              disabled={choice.disabled}
              onClick={() => {
                haptic("selection")
                onValueChange(choice.value)
              }}
              className={cn(
                "flex min-h-11 items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
  "aria-describedby": ariaDescribedBy,
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
  "aria-describedby"?: string
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
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid ? true : undefined}
        className={cn("h-(--control-h-form) w-full", className)}
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
  // Bounds can exclude all three — a term that ended last spring has no
  // "today" — and a pinned footer holding nothing is just a stray rule across
  // the screen, so the list is resolved before it is offered.
  const shortcutDays = relativeDays().filter((option) => allowed(option.date))
  const shortcuts = (
    <div className="flex flex-wrap gap-2">
      {shortcutDays.map((option) => {
        const date = option.date
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

  const pager = (fill: boolean) => (
    <MonthPagerCalendar
      selected={selected}
      min={lower ?? undefined}
      max={upper ?? undefined}
      onSelect={pick}
      fill={fill}
    />
  )

  // When the date is the whole screen there is nothing to open: the calendar
  // is the screen. Same rule as the subject list. No shortcut chips here —
  // "today" is one tap on the month anyway, since that is where a calendar
  // opens, and the row was costing the calendar a chip-row of height.
  if (layout === "page" && !wide) {
    return <div className="rounded-xl border bg-card p-3">{pager(false)}</div>
  }

  if (!wide) {
    return (
      <>
        <button
          type="button"
          id={id}
          disabled={disabled}
          data-invalid={invalid ? "" : undefined}
          onClick={() => {
            haptic("selection")
            setOpen(true)
          }}
          className={cn(
            "flex min-h-12 w-full items-center gap-2 rounded-md border bg-transparent px-3 text-left text-sm shadow-xs disabled:opacity-50 data-invalid:border-destructive",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </button>

        {/* The month takes the screen and the shortcuts take the footer: a
            chip row at the top scrolled out of thumb reach and cost the
            calendar a row of height, while the layer's own footer is pinned
            exactly where a thumb already is. */}
        <FullScreenLayer
          open={open}
          onClose={() => setOpen(false)}
          title={t("Pick a date")}
          description={selected ? label : undefined}
          footer={shortcutDays.length > 0 ? shortcuts : undefined}
        >
          <div className="flex h-full flex-col justify-center p-4">
            {pager(true)}
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
              className
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
        className="h-(--control-h-form) w-full"
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
        className="h-(--control-h-form) min-w-0 flex-1"
      />
      <Input
        type="time"
        aria-label={t("Time")}
        value={timePart}
        disabled={disabled || !datePart}
        onChange={(event) => commit(datePart, event.target.value)}
        className="h-(--control-h-form) w-28 shrink-0"
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
  collapsible = false,
  summary,
  forceOpen = false,
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
  /**
   * A refinement section folds to a single line until asked for, so a long
   * form reads as a handful of decisions rather than a wall. Every control
   * stays one click away and none is removed.
   */
  collapsible?: boolean
  /** One-line readout of the folded section's current state. */
  summary?: string
  /** Keeps the section open — e.g. while a field inside it has an error. */
  forceOpen?: boolean
}) {
  const [opened, setOpened] = useState(false)

  if (!collapsible) {
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

  const expanded = opened || forceOpen
  return (
    <section className={cn("flex flex-col", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        disabled={forceOpen}
        onClick={() => setOpened(!expanded)}
        className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {expanded ? (
            description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null
          ) : (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {summary?.trim() ? summary : "—"}
            </p>
          )}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
      {expanded ? (
        <div className="flex flex-col gap-4 pt-3">{children}</div>
      ) : null}
    </section>
  )
}

/**
 * A colour from the theme's own set, or none.
 *
 * Swatches rather than a list of names: the choice *is* the colour, and a reader picking
 * "chart-3" from a dropdown has to imagine what that looks like. Radio semantics so a
 * keyboard walks the row and a screen reader announces which is chosen — the accent is
 * decoration on screen and a real setting underneath.
 *
 * Shared rather than private to the card editor: a dashboard card and a kind of
 * assessment both carry an accent, and two palettes that drifted apart would let a card
 * and its type be different shades of the same idea.
 */
export function AccentField({
  value,
  onValueChange,
  label,
}: {
  value: string | null
  onValueChange: (value: string | null) => void
  /** Defaults to "Colour"; a caller with two of these needs to say which. */
  label?: string
}) {
  const t = useExtracted()
  const heading = label ?? t("Colour")
  const accentLabels: Record<string, string> = {
    primary: t("Accent"),
    positive: t("Green"),
    "chart-2": t("Teal"),
    "chart-3": t("Blue"),
    "chart-4": t("Purple"),
    "chart-5": t("Amber"),
  }
  /**
   * The choices in order, so the arrow keys can walk them.
   *
   * A `radiogroup` promises a particular set of keys: one tab stop for the group, arrows
   * to move within it, and the move selects. Declaring the role without any of that told
   * assistive technology it was a radio group and then behaved like a row of buttons —
   * eight tab stops and no arrow keys, which is worse than no role at all.
   */
  const choices: Array<{ value: string | null; label: string }> = [
    { value: null, label: t("No colour") },
    ...CARD_ACCENTS.map((accent) => ({
      value: accent.value,
      label: accentLabels[accent.value] ?? accent.label,
    })),
  ]
  const current = Math.max(
    0,
    choices.findIndex((choice) => choice.value === value)
  )
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : event.key === "Home"
            ? -current
            : event.key === "End"
              ? choices.length - 1 - current
              : 0
    if (step === 0 && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    // Wrapping, as a radio group does: past the last colour is the first one.
    const next = (current + step + choices.length * 2) % choices.length
    onValueChange(choices[next]?.value ?? null)
    const group = event.currentTarget
    const buttons = group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    buttons[next]?.focus()
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{heading}</span>
      <div
        role="radiogroup"
        aria-label={heading}
        className="flex flex-wrap gap-2"
        onKeyDown={onKeyDown}
      >
        {choices.map((choice, index) => {
          const accent = CARD_ACCENTS.find(
            (item) => item.value === choice.value
          )
          const checked = value === choice.value
          return (
            <button
              key={choice.value ?? "none"}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={choice.label}
              // One tab stop for the whole group, landing on the current choice.
              tabIndex={index === current ? 0 : -1}
              onClick={() => onValueChange(choice.value)}
              className={cn(
                "flex size-9 items-center justify-center rounded-full border-2",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                checked ? "border-foreground" : "border-transparent"
              )}
            >
              <span
                className={cn(
                  "size-6 rounded-full",
                  accent ? accent.swatch : "border border-dashed"
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
