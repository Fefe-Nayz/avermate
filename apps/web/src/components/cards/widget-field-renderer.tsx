"use client"

import { useId, useState } from "react"
import { PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import type {
  WidgetCollectionField,
  WidgetCollectionSchema,
  WidgetFlowCondition,
  WidgetFlowField,
  WidgetFlowOption,
  WidgetOptionProvider,
} from "@avermate/core/widget-types"
import {
  ChoiceField,
  DateField,
  NumberField,
  SelectField,
  TextField,
} from "@/components/forms/controls"
import { PickerField } from "@/components/forms/picker"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  setWidgetDraftValue,
  widgetDraftValue,
  type WidgetDraftValue,
} from "./widget-draft"

export type WidgetMessage = (key: string) => string
export type WidgetOptionSets = Partial<
  Record<WidgetOptionProvider, WidgetFlowOption[]>
>

interface CommonField {
  id: string
  path: string
  control: WidgetCollectionField["control"] | WidgetFlowField["control"]
  messageKey: string
  descriptionKey: string | null
  required: boolean
  options?: WidgetFlowOption[]
  optionProvider?: WidgetOptionProvider
  min?: number
  max?: number
  step?: number
}

interface WidgetFieldRendererProps {
  field: WidgetFlowField
  draft: WidgetDraftValue
  message: WidgetMessage
  optionSets?: WidgetOptionSets
  onChange: (draft: WidgetDraftValue) => void
}

export function WidgetFieldRenderer({
  field,
  draft,
  message,
  optionSets,
  onChange,
}: WidgetFieldRendererProps) {
  if (field.collection) {
    return (
      <CollectionEditor
        field={field}
        schema={field.collection}
        draft={draft}
        message={message}
        optionSets={optionSets}
        onChange={onChange}
      />
    )
  }

  return (
    <ScalarField
      field={field}
      value={widgetDraftValue(draft, field.path)}
      message={message}
      optionSets={optionSets}
      error={field.error ? message(field.error) : undefined}
      onValueChange={(value) =>
        onChange(setWidgetDraftValue(draft, field.path, value))
      }
    />
  )
}

function fieldOptions(
  field: CommonField,
  optionSets: WidgetOptionSets | undefined
): WidgetFlowOption[] {
  if (field.options && field.options.length > 0) return field.options
  if (field.optionProvider) return optionSets?.[field.optionProvider] ?? []
  return field.options ?? []
}

function ScalarField({
  field,
  value,
  message,
  optionSets,
  error,
  onValueChange,
}: {
  field: CommonField
  value: WidgetDraftValue | undefined
  message: WidgetMessage
  optionSets?: WidgetOptionSets
  error?: string
  onValueChange: (value: WidgetDraftValue) => void
}) {
  const id = useId()
  const label = message(field.messageKey)
  const description = field.descriptionKey
    ? message(field.descriptionKey)
    : undefined
  const options = fieldOptions(field, optionSets)
  const translated = options.map((option) => ({
    value: option.value,
    label: message(option.messageKey),
    disabled: option.disabled,
  }))

  switch (field.control) {
    case "choice":
      return translated.length <= 6 ? (
        <ChoiceField
          label={label}
          description={description}
          choices={translated}
          value={typeof value === "string" ? value : ""}
          onValueChange={onValueChange}
          columns={translated.length > 3 ? 2 : 1}
        />
      ) : (
        <SelectField
          label={label}
          description={description}
          error={error}
          required={field.required}
          options={translated}
          value={typeof value === "string" ? value : ""}
          onValueChange={onValueChange}
        />
      )

    case "multi-choice": {
      const selected = new Set(
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : []
      )
      return (
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel>{label}</FieldLabel>
          <div className="overflow-hidden rounded-xl border bg-card">
            {translated.map((option, index) => (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-11 items-center gap-3 px-3 py-2 text-sm",
                  index > 0 && "border-t",
                  option.disabled && "opacity-50"
                )}
              >
                <Checkbox
                  checked={selected.has(option.value)}
                  disabled={option.disabled}
                  onCheckedChange={(checked) => {
                    const next = new Set(selected)
                    if (checked) next.add(option.value)
                    else next.delete(option.value)
                    onValueChange([...next])
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {description && !error ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      )
    }

    case "reference":
      return (
        <PickerField
          label={label}
          description={description}
          error={error}
          required={field.required}
          options={translated}
          value={typeof value === "string" ? value : null}
          onValueChange={onValueChange}
        />
      )

    case "number":
      return (
        <NumberField
          label={label}
          description={description}
          error={error}
          required={field.required}
          value={typeof value === "number" ? String(value) : ""}
          min={field.min}
          max={field.max}
          step={field.step}
          onValueChange={(next) => {
            if (next.trim() === "") return onValueChange(null)
            const numeric = Number(next)
            if (Number.isFinite(numeric)) onValueChange(numeric)
          }}
        />
      )

    case "date":
      return (
        <DateField
          label={label}
          description={description}
          error={error}
          required={field.required}
          value={typeof value === "string" ? value : ""}
          onValueChange={onValueChange}
        />
      )

    case "text":
      return (
        <TextField
          label={label}
          description={description}
          error={error}
          required={field.required}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )

    case "toggle":
      return (
        <Field orientation="horizontal" data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={id} className="flex-1">
            <span>{label}</span>
            {description ? (
              <span className="block text-xs font-normal text-muted-foreground">
                {description}
              </span>
            ) : null}
          </FieldLabel>
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={onValueChange}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      )

    case "color":
      return (
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              id={id}
              type="color"
              value={
                typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
                  ? value
                  : "#5b8def"
              }
              onChange={(event) => onValueChange(event.target.value)}
              className="size-10 cursor-pointer rounded-lg border bg-transparent p-1"
            />
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={message("widget.action.clear-color")}
                onClick={() => onValueChange(null)}
              >
                <XIcon />
              </Button>
            ) : null}
          </div>
          {description && !error ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      )

    case "encoding":
      return (
        <SelectField
          label={label}
          description={description}
          error={error}
          required={field.required}
          options={[
            { value: "__none__", label: message("widget.option.none") },
            ...translated,
          ]}
          value={typeof value === "string" ? value : "__none__"}
          onValueChange={(next) =>
            onValueChange(next === "__none__" ? null : next)
          }
        />
      )

    default:
      return null
  }
}

function conditionMatches(
  condition: WidgetFlowCondition,
  item: WidgetDraftValue
): boolean {
  switch (condition.kind) {
    case "always":
      return true
    case "equals":
      return widgetDraftValue(item, condition.path) === condition.value
    case "one-of":
      return condition.values.includes(
        widgetDraftValue(item, condition.path) as string | number | boolean
      )
    case "exists":
      return widgetDraftValue(item, condition.path) !== undefined
    case "and":
      return condition.conditions.every((entry) =>
        conditionMatches(entry, item)
      )
    case "or":
      return condition.conditions.some((entry) => conditionMatches(entry, item))
    case "not":
      return !conditionMatches(condition.condition, item)
    case "capability":
      return true
  }
}

function defaultValue(field: WidgetCollectionField): WidgetDraftValue {
  if (field.recursive) return defaultItem(WIDGET_SELF_SCHEMA.get(field)!)
  if (field.control === "toggle") return false
  if (field.control === "multi-choice") return []
  if (field.control === "number") return field.min ?? 0
  return field.options?.[0]?.value ?? ""
}

// Recursive fields reference their owning schema. A WeakMap keeps that
// relationship outside the serializable descriptor itself.
const WIDGET_SELF_SCHEMA = new WeakMap<
  WidgetCollectionField,
  WidgetCollectionSchema
>()

/** Variants permitted for a new item; existing items still use the full schema. */
export function collectionAddVariants(schema: WidgetCollectionSchema) {
  return schema.addVariants ?? schema.variants
}

function defaultItem(
  schema: WidgetCollectionSchema,
  variant = schema.variants[0]
): WidgetDraftValue {
  if (!variant) return {}
  let item: WidgetDraftValue = {}
  if (schema.discriminator) {
    item = setWidgetDraftValue(item, schema.discriminator, variant.value)
  }
  for (const field of variant.fields) {
    if (field.recursive) WIDGET_SELF_SCHEMA.set(field, schema)
    item = setWidgetDraftValue(item, field.path, defaultValue(field))
  }
  return item
}

function CollectionEditor({
  field,
  schema,
  draft,
  message,
  optionSets,
  onChange,
}: WidgetFieldRendererProps & { schema: WidgetCollectionSchema }) {
  const formula = field.control === "formula"
  const raw = widgetDraftValue(draft, field.path)
  const items = formula
    ? raw && typeof raw === "object" && !Array.isArray(raw)
      ? [raw]
      : []
    : Array.isArray(raw)
      ? raw
      : []
  // Existing items must keep the complete schema so their current kind remains
  // editable. The add row can be narrower: the flow removes variants that would be
  // invalid as another axis without making an already-stored outer axis disappear.
  const addVariants = collectionAddVariants(schema)
  const [variant, setVariant] = useState(addVariants[0]?.value ?? "")
  const selectedAddVariant =
    addVariants.find((entry) => entry.value === variant) ?? addVariants[0]
  const variants = addVariants.map((entry) => ({
    value: entry.value,
    label: message(entry.messageKey),
  }))

  const commit = (next: WidgetDraftValue[]) => {
    onChange(
      setWidgetDraftValue(draft, field.path, formula ? (next[0] ?? null) : next)
    )
  }
  const add = () => {
    if (!selectedAddVariant || items.length >= schema.maxItems) return
    commit([...items, defaultItem(schema, selectedAddVariant)])
  }

  return (
    <Field data-invalid={field.error ? true : undefined}>
      <FieldLabel>{message(field.messageKey)}</FieldLabel>
      <div className="flex flex-col gap-3">
        {items.map((item, index) => (
          <CollectionItem
            key={index}
            item={item}
            schema={schema}
            message={message}
            optionSets={optionSets}
            removable={!formula && items.length > schema.minItems}
            onRemove={() =>
              commit(items.filter((_, position) => position !== index))
            }
            onChange={(next) =>
              commit(
                items.map((entry, position) =>
                  position === index ? next : entry
                )
              )
            }
          />
        ))}

        {items.length < schema.maxItems && addVariants.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            {variants.length > 1 ? (
              <SelectField
                label={message(schema.addMessageKey)}
                value={selectedAddVariant?.value ?? ""}
                options={variants}
                onValueChange={setVariant}
                className="flex-1"
              />
            ) : null}
            <Button type="button" variant="outline" onClick={add}>
              <PlusIcon />
              {message(schema.addMessageKey)}
            </Button>
          </div>
        ) : null}
      </div>
      {field.descriptionKey && !field.error ? (
        <FieldDescription>{message(field.descriptionKey)}</FieldDescription>
      ) : null}
      {field.error ? <FieldError>{message(field.error)}</FieldError> : null}
    </Field>
  )
}

function CollectionItem({
  item,
  schema,
  message,
  optionSets,
  removable,
  onRemove,
  onChange,
}: {
  item: WidgetDraftValue
  schema: WidgetCollectionSchema
  message: WidgetMessage
  optionSets?: WidgetOptionSets
  removable: boolean
  onRemove: () => void
  onChange: (item: WidgetDraftValue) => void
}) {
  const selected = schema.discriminator
    ? String(widgetDraftValue(item, schema.discriminator) ?? "")
    : (schema.variants[0]?.value ?? "")
  const variant = schema.variants.find((entry) => entry.value === selected)

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-3 flex items-center gap-2">
        {schema.variants.length > 1 ? (
          <SelectField
            label={message("widget.field.variant")}
            value={selected}
            options={schema.variants.map((entry) => ({
              value: entry.value,
              label: message(entry.messageKey),
            }))}
            onValueChange={(next) => {
              const chosen = schema.variants.find(
                (entry) => entry.value === next
              )
              if (chosen) onChange(defaultItem(schema, chosen))
            }}
            className="min-w-0 flex-1"
          />
        ) : (
          <p className="min-w-0 flex-1 text-sm font-medium">
            {variant ? message(variant.messageKey) : null}
          </p>
        )}
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={message("widget.action.remove-item")}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        {variant?.fields
          .filter((child) => conditionMatches(child.visibleWhen, item))
          .map((child) => {
            if (child.recursive) {
              const nested =
                child.recursive === "self" ? schema : child.recursive
              WIDGET_SELF_SCHEMA.set(child, nested)
              const nestedValue = widgetDraftValue(item, child.path)
              return (
                <div key={child.id} className="border-l-2 pl-3">
                  <FieldLabel className="mb-2">
                    {message(child.messageKey)}
                  </FieldLabel>
                  <CollectionItem
                    item={
                      nestedValue &&
                      typeof nestedValue === "object" &&
                      !Array.isArray(nestedValue)
                        ? nestedValue
                        : defaultItem(nested)
                    }
                    schema={nested}
                    message={message}
                    optionSets={optionSets}
                    removable={false}
                    onRemove={() => undefined}
                    onChange={(next) =>
                      onChange(setWidgetDraftValue(item, child.path, next))
                    }
                  />
                </div>
              )
            }
            return (
              <ScalarField
                key={child.id}
                field={child}
                value={widgetDraftValue(item, child.path)}
                message={message}
                optionSets={optionSets}
                onValueChange={(next) =>
                  onChange(setWidgetDraftValue(item, child.path, next))
                }
              />
            )
          })}
      </div>
    </div>
  )
}
