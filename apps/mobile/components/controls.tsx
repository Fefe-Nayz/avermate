import { type ReactNode } from "react";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import {
  Column,
  Host,
  ListItem,
  Picker,
  Slider,
  Switch,
  TextInput,
} from "@expo/ui";
import type { KeyboardTypeOptions } from "react-native";
import { Section, Text } from "@/components/native";
import { haptic } from "@/lib/haptics";
import { locale, t } from "@/lib/i18n";
import { space, useIsDark, usePalette } from "@/lib/theme";

/**
 * Form controls, all of them the platform's own.
 *
 * The rule that shaped the previous version still holds — a form is a screen,
 * nothing overlays the field you are filling — but every control here is now
 * the real UIKit or Compose one. That is worth more than any of them looked:
 * the keyboard accessory, the text selection handles, the picker's haptics and
 * the calendar's date logic are all things this app no longer implements.
 *
 * Text fields are uncontrolled. `defaultValue` seeds them and `onChangeText`
 * reports; keeping a React state as the second source of truth is what makes
 * native inputs fight the cursor.
 */

export interface Choice {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** Nesting depth, rendered as indentation in the subject tree. */
  depth?: number;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  keyboardType,
  autoCapitalize = "sentences",
  autoComplete,
  secureTextEntry,
  autoFocus,
  multiline,
  align = "right",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "email" | "name" | "password" | "new-password" | "off";
  secureTextEntry?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
  align?: "left" | "right";
}) {
  const palette = usePalette();

  // A multiline field needs the whole row width, so the label moves above it.
  if (multiline) {
    return (
      <Column spacing={space.sm}>
        <Text size="label" tone="faint">
          {label}
        </Text>
        <TextInput
          defaultValue={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          multiline
          rows={3}
          autoCapitalize={autoCapitalize}
        />
        {error ? (
          <Text size="footnote" tone="negative">
            {error}
          </Text>
        ) : null}
      </Column>
    );
  }

  return (
    <ListItem
      supportingText={
        error ? (
          <Text size="footnote" tone="negative">
            {error}
          </Text>
        ) : undefined
      }
      trailing={
        <TextInput
          defaultValue={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          secureTextEntry={secureTextEntry}
          autoFocus={autoFocus}
          textAlign={align}
          cursorColor={palette.accent}
        />
      }
    >
      <Text>{label}</Text>
    </ListItem>
  );
}

/**
 * One of many, as the platform's menu picker.
 *
 * `menu` rather than `wheel`: a wheel hides its options behind a gesture and
 * costs a scroll to read three of them. The menu shows the list, marks the
 * selection, and dismisses itself — and it is the control the OS uses for
 * exactly this everywhere else.
 */
export function PickerField({
  label,
  choices,
  value,
  onChange,
  error,
}: {
  label: string;
  choices: Choice[];
  value: string | null;
  onChange: (value: string) => void;
  error?: string;
}) {
  const selected = choices.find((choice) => choice.value === value);

  return (
    <ListItem
      supportingText={
        error ? (
          <Text size="footnote" tone="negative">
            {error}
          </Text>
        ) : undefined
      }
      trailing={
        <Picker
          selectedValue={selected?.value ?? ""}
          appearance="menu"
          onValueChange={(next) => {
            haptic("selection");
            onChange(String(next));
          }}
        >
          {choices
            .filter((choice) => !choice.disabled)
            .map((choice) => (
              <Picker.Item
                key={choice.value}
                // Indentation is the only cue a flat menu has for a tree.
                label={`${"   ".repeat(choice.depth ?? 0)}${choice.label}`}
                value={choice.value}
              />
            ))}
        </Picker>
      }
    >
      <Text>{label}</Text>
    </ListItem>
  );
}

/**
 * A small, fixed set of options, shown in full rather than behind a menu.
 * Used where the choice itself needs explaining — subject versus category.
 */
export function ChoiceField({
  title,
  choices,
  value,
  onChange,
}: {
  title?: string;
  choices: Choice[];
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <Section title={title}>
      {choices.map((choice) => (
        <ListItem
          key={choice.value}
          onPress={
            choice.disabled
              ? undefined
              : () => {
                  haptic("selection");
                  onChange(choice.value);
                }
          }
          supportingText={choice.hint}
          trailing={
            choice.value === value ? <SelectedMark /> : undefined
          }
        >
          <Text tone={choice.disabled ? "faint" : "text"}>{choice.label}</Text>
        </ListItem>
      ))}
    </Section>
  );
}

function SelectedMark() {
  const palette = usePalette();
  return <Text color={palette.accent}>✓</Text>;
}

/**
 * A date, picked in the platform's own calendar, laid out inline in the form.
 * `compact` keeps it to a single row until it is tapped, which is the one
 * behaviour that lets a date live in a form without dominating it.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: Date;
  onChange: (value: Date) => void;
  min?: Date;
  max?: Date;
}) {
  const palette = usePalette();
  const isDark = useIsDark();

  return (
    <ListItem
      trailing={
        <DateTimePicker
          value={value}
          mode="date"
          display="compact"
          presentation="inline"
          minimumDate={min}
          maximumDate={max}
          accentColor={palette.accent}
          themeVariant={isDark ? "dark" : "light"}
          locale={locale() === "fr" ? "fr-FR" : "en-GB"}
          onValueChange={(_event, date) => {
            haptic("light");
            onChange(date);
          }}
        />
      }
    >
      <Text>{label}</Text>
    </ListItem>
  );
}

export function SwitchField({
  label,
  detail,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <ListItem
      supportingText={detail}
      trailing={
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            haptic("light");
            onValueChange(next);
          }}
        />
      }
    >
      <Text>{label}</Text>
    </ListItem>
  );
}

/** A value dragged rather than typed, with the number above the track. */
export function SliderField({
  label,
  value,
  onValueChange,
  min = 0,
  max = 1,
  step,
  display,
}: {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** How to render the current value. Defaults to the raw number. */
  display?: (value: number) => string;
}) {
  return (
    <Column spacing={space.sm}>
      <ListItem trailing={<Text mono>{display?.(value) ?? String(value)}</Text>}>
        <Text>{label}</Text>
      </ListItem>
      <Slider
        value={value}
        onValueChange={onValueChange}
        min={min}
        max={max}
        step={step}
      />
    </Column>
  );
}

/**
 * A switcher for the scope of a screen — a period, a metric, a range.
 * Segmented while it fits on one line, a menu once it does not.
 */
export function Segments({
  choices,
  value,
  onChange,
  label,
}: {
  choices: Choice[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  if (choices.length <= 1) return null;

  return (
    <Picker
      selectedValue={value}
      appearance={choices.length > 4 ? "menu" : "wheel"}
      onValueChange={(next) => {
        haptic("selection");
        onChange(String(next));
      }}
      testID={label}
    >
      {choices.map((choice) => (
        <Picker.Item
          key={choice.value}
          label={choice.label}
          value={choice.value}
        />
      ))}
    </Picker>
  );
}

/**
 * A control that has to sit outside a `Host` — in a header, over a chart.
 * Everything else in this file is already inside one.
 */
export function Standalone({ children }: { children: ReactNode }) {
  const isDark = useIsDark();
  return (
    <Host matchContents colorScheme={isDark ? "dark" : "light"}>
      <Column>{children}</Column>
    </Host>
  );
}

export { t };
