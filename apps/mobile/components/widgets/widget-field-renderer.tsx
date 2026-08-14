import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  WidgetCapability,
  WidgetCollectionField,
  WidgetCollectionSchema,
  WidgetFlowCondition,
  WidgetFlowField,
  WidgetFlowOption,
  WidgetOptionProvider,
} from "@avermate/core";
import { DateField } from "@/components/date-field";
import {
  ChoiceField,
  PickerField,
  SwitchField,
  TextField,
} from "@/components/field";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { radius, space, type, usePalette } from "@/lib/theme";
import { widgetMessage } from "./widget-messages";
import {
  widgetFieldOptions,
  type WidgetOptionSets,
} from "./widget-option-model";
import {
  setWidgetDraftValue,
  widgetDraftValue,
  type WidgetDraftValue,
} from "./widget-draft";

interface CommonField {
  id: string;
  path: string;
  control: WidgetCollectionField["control"] | WidgetFlowField["control"];
  messageKey: string;
  descriptionKey: string | null;
  required: boolean;
  options?: WidgetFlowOption[];
  optionProvider?: WidgetOptionProvider;
  min?: number;
  max?: number;
  step?: number;
}

export function WidgetFieldRenderer({
  field,
  draft,
  capability,
  optionSets,
  onChange,
}: {
  field: WidgetFlowField;
  draft: WidgetDraftValue;
  capability: WidgetCapability;
  optionSets?: WidgetOptionSets;
  onChange: (draft: WidgetDraftValue) => void;
}) {
  if (field.collection) {
    return (
      <CollectionEditor
        field={field}
        schema={field.collection}
        draft={draft}
        capability={capability}
        optionSets={optionSets}
        onChange={onChange}
      />
    );
  }

  return (
    <ScalarField
      field={field}
      value={widgetDraftValue(draft, field.path)}
      optionSets={optionSets}
      error={field.error ? widgetMessage(field.error) : undefined}
      onValueChange={(value) =>
        onChange(setWidgetDraftValue(draft, field.path, value))
      }
    />
  );
}

function NumberInput({
  field,
  value,
  error,
  onValueChange,
}: {
  field: CommonField;
  value: WidgetDraftValue | undefined;
  error?: string;
  onValueChange: (value: WidgetDraftValue) => void;
}) {
  const external = typeof value === "number" ? String(value) : "";
  const [text, setText] = useState(external);
  useEffect(() => setText(external), [external]);

  return (
    <TextField
      label={widgetMessage(field.messageKey)}
      value={text}
      keyboardType="decimal-pad"
      error={error}
      onChangeText={(next) => {
        setText(next);
        if (next.trim() === "") {
          onValueChange(null);
          return;
        }
        const numeric = Number(next.replace(",", "."));
        if (!Number.isFinite(numeric)) return;
        const base = field.min ?? 0;
        const stepped = field.step
          ? base + Math.round((numeric - base) / field.step) * field.step
          : numeric;
        const bounded = Math.max(
          field.min ?? Number.NEGATIVE_INFINITY,
          Math.min(field.max ?? Number.POSITIVE_INFINITY, stepped),
        );
        onValueChange(bounded);
      }}
    />
  );
}

function MultiChoice({
  label,
  options,
  value,
  error,
  onValueChange,
}: {
  label: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  value: WidgetDraftValue | undefined;
  error?: string;
  onValueChange: (value: WidgetDraftValue) => void;
}) {
  const palette = usePalette();
  const selected = new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [],
  );
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
      <View
        style={{
          overflow: "hidden",
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: error ? palette.negative : palette.border,
          backgroundColor: palette.surface,
        }}
      >
        {options.map((option, index) => {
          const active = selected.has(option.value);
          return (
            <Pressable
              key={option.value}
              disabled={option.disabled}
              onPress={() => {
                haptic("selection");
                const next = new Set(selected);
                if (active) next.delete(option.value);
                else next.add(option.value);
                onValueChange([...next]);
              }}
              style={({ pressed }) => ({
                minHeight: 48,
                paddingHorizontal: space.md,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: palette.hairline,
                backgroundColor:
                  pressed || active ? palette.accentSoft : "transparent",
                opacity: option.disabled ? 0.4 : 1,
              })}
            >
              <Text style={[type.body, { flex: 1, color: palette.text }]}>
                {option.label}
              </Text>
              {active ? (
                <Icon name="checkmark" size={18} color={palette.accent} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text style={[type.footnote, { color: palette.negative }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function ColorField({
  field,
  value,
  onValueChange,
}: {
  field: CommonField;
  value: WidgetDraftValue | undefined;
  onValueChange: (value: WidgetDraftValue) => void;
}) {
  const palette = usePalette();
  const colors = ["#2563EB", "#16A34A", "#DC2626", "#D97706", "#7C3AED"];
  const selected = typeof value === "string" ? value : null;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: palette.textFaint }]}>
        {widgetMessage(field.messageKey)}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {colors.map((color) => (
          <Pressable
            key={color}
            accessibilityRole="radio"
            accessibilityState={{ selected: selected === color }}
            onPress={() => onValueChange(color)}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: color,
              borderWidth: selected === color ? 3 : 1,
              borderColor: selected === color ? palette.text : palette.border,
            }}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => onValueChange(null)}
          style={{
            width: 42,
            height: 42,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 21,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            backgroundColor: palette.surface,
          }}
        >
          <Icon name="remove-outline" size={18} color={palette.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function ScalarField({
  field,
  value,
  optionSets,
  error,
  onValueChange,
}: {
  field: CommonField;
  value: WidgetDraftValue | undefined;
  optionSets?: WidgetOptionSets;
  error?: string;
  onValueChange: (value: WidgetDraftValue) => void;
}) {
  const label = widgetMessage(field.messageKey);
  const options = widgetFieldOptions(field, optionSets).map((entry) => ({
    value: entry.value,
    label: widgetMessage(entry.messageKey),
    disabled: entry.disabled,
  }));

  switch (field.control) {
    case "choice":
      return options.length <= 6 ? (
        <ChoiceField
          label={label}
          choices={options}
          value={typeof value === "string" ? value : null}
          onChange={onValueChange}
          error={error}
          columns={options.length > 3 ? 2 : 1}
        />
      ) : (
        <PickerField
          label={label}
          choices={options}
          value={typeof value === "string" ? value : null}
          onChange={onValueChange}
          error={error}
        />
      );
    case "reference":
    case "encoding":
      return (
        <View style={{ gap: space.xs }}>
          <PickerField
            label={label}
            choices={options}
            value={typeof value === "string" ? value : null}
            onChange={onValueChange}
            error={error}
          />
          {field.control === "encoding" &&
          !field.required &&
          typeof value === "string" ? (
            <Button
              label={widgetMessage("widget.action.clear-encoding")}
              icon="close-circle"
              variant="ghost"
              size="sm"
              onPress={() => onValueChange(null)}
            />
          ) : null}
        </View>
      );
    case "multi-choice":
      return (
        <MultiChoice
          label={label}
          options={options}
          value={value}
          error={error}
          onValueChange={onValueChange}
        />
      );
    case "number":
      return (
        <NumberInput
          field={field}
          value={value}
          error={error}
          onValueChange={onValueChange}
        />
      );
    case "date": {
      const parsed =
        typeof value === "string" ? new Date(`${value}T12:00:00`) : new Date();
      const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
      return (
        <DateField
          label={label}
          value={date}
          onChange={(next) => onValueChange(next.toISOString().slice(0, 10))}
        />
      );
    }
    case "text":
      return (
        <TextField
          label={label}
          value={typeof value === "string" ? value : ""}
          onChangeText={onValueChange}
          error={error}
        />
      );
    case "toggle":
      return (
        <SwitchField
          label={label}
          value={value === true}
          onValueChange={onValueChange}
        />
      );
    case "color":
      return (
        <ColorField field={field} value={value} onValueChange={onValueChange} />
      );
    default:
      return null;
  }
}

function conditionMatches(
  condition: WidgetFlowCondition,
  item: WidgetDraftValue,
  capability: WidgetCapability,
): boolean {
  switch (condition.kind) {
    case "always":
      return true;
    case "equals":
      return widgetDraftValue(item, condition.path) === condition.value;
    case "one-of":
      return condition.values.includes(
        widgetDraftValue(item, condition.path) as string | number | boolean,
      );
    case "exists": {
      const value = widgetDraftValue(item, condition.path);
      return value !== undefined && value !== null && value !== "";
    }
    case "and":
      return condition.conditions.every((entry) =>
        conditionMatches(entry, item, capability),
      );
    case "or":
      return condition.conditions.some((entry) =>
        conditionMatches(entry, item, capability),
      );
    case "not":
      return !conditionMatches(condition.condition, item, capability);
    case "capability": {
      const candidate = widgetDraftValue(item, condition.path);
      return (capability[condition.property] as readonly unknown[]).includes(
        candidate,
      );
    }
  }
}

function defaultValue(
  field: WidgetCollectionField,
  owner: WidgetCollectionSchema,
): WidgetDraftValue {
  if (field.recursive) {
    const nested = field.recursive === "self" ? owner : field.recursive;
    return defaultItem(nested);
  }
  if (field.control === "toggle") return false;
  if (field.control === "multi-choice") return [];
  if (field.control === "number") return field.min ?? 0;
  return field.options?.[0]?.value ?? "";
}

function defaultItem(
  schema: WidgetCollectionSchema,
  variant = schema.variants[0],
): WidgetDraftValue {
  if (!variant) return {};
  let item: WidgetDraftValue = {};
  if (schema.discriminator) {
    item = setWidgetDraftValue(item, schema.discriminator, variant.value);
  }
  for (const field of variant.fields) {
    item = setWidgetDraftValue(item, field.path, defaultValue(field, schema));
  }
  return item;
}

function CollectionEditor({
  field,
  schema,
  draft,
  capability,
  optionSets,
  onChange,
}: {
  field: WidgetFlowField;
  schema: WidgetCollectionSchema;
  draft: WidgetDraftValue;
  capability: WidgetCapability;
  optionSets?: WidgetOptionSets;
  onChange: (draft: WidgetDraftValue) => void;
}) {
  const palette = usePalette();
  const formula = field.control === "formula";
  const raw = widgetDraftValue(draft, field.path);
  const items: WidgetDraftValue[] = formula
    ? raw && typeof raw === "object" && !Array.isArray(raw)
      ? [raw]
      : []
    : Array.isArray(raw)
      ? raw
      : [];
  const [variant, setVariant] = useState(schema.variants[0]?.value ?? "");
  const variants = schema.variants.map((entry) => ({
    value: entry.value,
    label: widgetMessage(entry.messageKey),
  }));
  const commit = (next: WidgetDraftValue[]) => {
    onChange(
      setWidgetDraftValue(
        draft,
        field.path,
        formula ? (next[0] ?? null) : next,
      ),
    );
  };
  const add = () => {
    const selected =
      schema.variants.find((entry) => entry.value === variant) ??
      schema.variants[0];
    if (!selected || items.length >= schema.maxItems) return;
    commit([...items, defaultItem(schema, selected)]);
  };

  return (
    <View style={{ gap: space.md }}>
      <Text style={[type.label, { color: palette.textFaint }]}>
        {widgetMessage(field.messageKey)}
      </Text>
      {items.map((item, index) => (
        <CollectionItem
          key={index}
          item={item}
          schema={schema}
          capability={capability}
          optionSets={optionSets}
          removable={!formula && items.length > schema.minItems}
          onRemove={() =>
            commit(items.filter((_, position) => position !== index))
          }
          onChange={(next) =>
            commit(
              items.map((entry, position) =>
                position === index ? next : entry,
              ),
            )
          }
        />
      ))}
      {items.length < schema.maxItems ? (
        <View style={{ gap: space.sm }}>
          {variants.length > 1 ? (
            <PickerField
              label={widgetMessage(schema.addMessageKey)}
              choices={variants}
              value={variant}
              onChange={setVariant}
            />
          ) : null}
          <Button
            label={widgetMessage(schema.addMessageKey)}
            icon="add-circle"
            variant="outline"
            onPress={add}
          />
        </View>
      ) : null}
      {field.error ? (
        <Text style={[type.footnote, { color: palette.negative }]}>
          {widgetMessage(field.error)}
        </Text>
      ) : null}
    </View>
  );
}

function CollectionItem({
  item,
  schema,
  capability,
  optionSets,
  removable,
  onRemove,
  onChange,
}: {
  item: WidgetDraftValue;
  schema: WidgetCollectionSchema;
  capability: WidgetCapability;
  optionSets?: WidgetOptionSets;
  removable: boolean;
  onRemove: () => void;
  onChange: (item: WidgetDraftValue) => void;
}) {
  const palette = usePalette();
  const selected = schema.discriminator
    ? String(widgetDraftValue(item, schema.discriminator) ?? "")
    : (schema.variants[0]?.value ?? "");
  const variant = schema.variants.find((entry) => entry.value === selected);

  return (
    <View
      style={{
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}
      >
        <View style={{ flex: 1 }}>
          {schema.variants.length > 1 ? (
            <PickerField
              label={widgetMessage("widget.field.variant")}
              choices={schema.variants.map((entry) => ({
                value: entry.value,
                label: widgetMessage(entry.messageKey),
              }))}
              value={selected}
              onChange={(next) => {
                const chosen = schema.variants.find(
                  (entry) => entry.value === next,
                );
                if (chosen) onChange(defaultItem(schema, chosen));
              }}
            />
          ) : (
            <Text style={[type.heading, { color: palette.text }]}>
              {variant ? widgetMessage(variant.messageKey) : ""}
            </Text>
          )}
        </View>
        {removable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={widgetMessage("widget.action.remove-item")}
            onPress={onRemove}
            style={{
              width: 46,
              height: 46,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.border,
            }}
          >
            <Icon name="trash-outline" size={18} color={palette.negative} />
          </Pressable>
        ) : null}
      </View>
      {variant?.fields
        .filter((child) =>
          conditionMatches(child.visibleWhen, item, capability),
        )
        .map((child) => {
          if (child.recursive) {
            const nested =
              child.recursive === "self" ? schema : child.recursive;
            const nestedValue = widgetDraftValue(item, child.path);
            return (
              <View
                key={child.id}
                style={{
                  gap: space.sm,
                  paddingLeft: space.md,
                  borderLeftWidth: 2,
                  borderLeftColor: palette.accentSoft,
                }}
              >
                <Text style={[type.label, { color: palette.textFaint }]}>
                  {widgetMessage(child.messageKey)}
                </Text>
                <CollectionItem
                  item={
                    nestedValue &&
                    typeof nestedValue === "object" &&
                    !Array.isArray(nestedValue)
                      ? nestedValue
                      : defaultItem(nested)
                  }
                  schema={nested}
                  capability={capability}
                  optionSets={optionSets}
                  removable={false}
                  onRemove={() => undefined}
                  onChange={(next) =>
                    onChange(setWidgetDraftValue(item, child.path, next))
                  }
                />
              </View>
            );
          }
          return (
            <ScalarField
              key={child.id}
              field={child}
              value={widgetDraftValue(item, child.path)}
              optionSets={optionSets}
              onValueChange={(next) =>
                onChange(setWidgetDraftValue(item, child.path, next))
              }
            />
          );
        })}
    </View>
  );
}
