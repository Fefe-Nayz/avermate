"use client";

import { useId, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import { useLocale } from "next-intl";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

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
  label: string;
  description?: string;
  error?: string;
}) {
  const id = useId();
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
  );
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
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  suffix?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: string | number;
  placeholder?: string;
}) {
  const id = useId();
  const locale = useLocale();
  // French keyboards produce a comma; accepting only a dot would silently
  // reject half the numbers people type.
  const decimalHint = locale.startsWith("fr") ? "[0-9]*[.,]?[0-9]*" : undefined;

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
          className={cn("h-11 numeric md:h-9", suffix && "pr-12")}
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
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
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
  label?: string;
  description?: string;
  choices: Array<Choice<T>>;
  value: T;
  onValueChange: (value: T) => void;
  columns?: 1 | 2 | 3;
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
        )}
      >
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                haptic("selection");
                onValueChange(choice.value);
              }}
              className={cn(
                "flex min-h-11 items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/6 ring-1 ring-primary/40"
                  : "border-border bg-card hover:bg-accent/50 active:bg-accent",
              )}
            >
              {choice.icon ? (
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    selected ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {choice.icon}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{choice.label}</span>
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
          );
        })}
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

/** A labelled section inside a form screen. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {title ? (
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
