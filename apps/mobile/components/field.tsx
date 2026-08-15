import { useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";
import { Icon } from "@/components/icon";
import { haptic } from "@/lib/haptics";
import { NativeSlider, NativeSwitch } from "@/components/native-controls";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

/**
 * Form controls.
 *
 * Every target clears 52pt, numeric fields open the numeric keypad, and a
 * choice that would be a native picker is laid out as tappable rows instead —
 * a wheel picker hides its options behind a gesture, which is the wrong trade
 * when there are four of them.
 */

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
  align = "left",
  suffix,
  multiline,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words";
  autoComplete?: "email" | "name" | "password" | "new-password" | "off";
  secureTextEntry?: boolean;
  autoFocus?: boolean;
  align?: "left" | "right";
  suffix?: string;
  /** Grows to several lines; the label moves above the box. */
  multiline?: boolean;
  maxLength?: number;
}) {
  const palette = usePalette();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          // A multiline box grows downward, so its content hangs from the top
          // rather than sitting on the centre line of a box that keeps moving.
          alignItems: multiline ? "flex-start" : "center",
          backgroundColor: palette.surface,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: error
            ? palette.negative
            : focused
              ? palette.accent
              : palette.border,
          paddingHorizontal: space.md,
          minHeight: multiline ? 96 : 52,
        }}
      >
        <TextInput
          multiline={multiline}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.textFaint}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          secureTextEntry={secureTextEntry}
          autoFocus={autoFocus}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            type.body,
            keyboardType === "decimal-pad" || keyboardType === "number-pad"
              ? numeric
              : null,
            {
              flex: 1,
              color: palette.text,
              paddingVertical: space.md,
              textAlign: align,
            },
          ]}
        />
        {suffix ? (
          <Text style={[type.body, { color: palette.textFaint }]}>
            {suffix}
          </Text>
        ) : null}
      </View>
      {error ? (
        <Text style={[type.footnote, { color: palette.negative }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export interface Choice<TValue extends string = string> {
  value: TValue;
  label: string;
  hint?: string;
  disabled?: boolean;
  depth?: number;
}

/** Radio behaviour, card presentation — usable with one thumb. */
export function ChoiceField<TValue extends string = string>({
  label,
  choices,
  value,
  onChange,
  error,
  columns = 1,
}: {
  label?: string;
  choices: Choice<TValue>[];
  value: TValue | null;
  onChange: (value: TValue) => void;
  error?: string;
  columns?: 1 | 2;
}) {
  const palette = usePalette();

  return (
    <View style={{ gap: space.sm }}>
      {label ? (
        <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
      ) : null}
      <View
        style={{
          flexDirection: columns === 2 ? "row" : "column",
          flexWrap: columns === 2 ? "wrap" : "nowrap",
          gap: space.sm,
        }}
      >
        {choices.map((choice) => {
          const active = choice.value === value;
          return (
            <Pressable
              key={choice.value}
              disabled={choice.disabled}
              onPress={() => {
                haptic("selection");
                onChange(choice.value);
              }}
              style={{
                flexBasis: columns === 2 ? "48%" : undefined,
                flexGrow: columns === 2 ? 1 : 0,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                minHeight: 52,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                backgroundColor: active ? palette.accentSoft : palette.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: active ? palette.accent : palette.border,
                opacity: choice.disabled ? 0.4 : 1,
                marginLeft: (choice.depth ?? 0) * 14,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.body, { color: palette.text }]}>
                  {choice.label}
                </Text>
                {choice.hint ? (
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {choice.hint}
                  </Text>
                ) : null}
              </View>
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

/**
 * A one-of-many picker that expands in place.
 *
 * Collapsed it is a single row showing the selection; open it becomes a list
 * below. Nothing overlays the form, so the keyboard never covers the thing
 * being picked and a back gesture still means "leave the screen".
 */
export function PickerField({
  label,
  choices,
  value,
  onChange,
  placeholder,
  error,
  emptyHint,
}: {
  label: string;
  choices: Choice[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  emptyHint?: string;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const selected = choices.find((choice) => choice.value === value);

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
      <View
        style={{
          backgroundColor: palette.surface,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: error ? palette.negative : palette.border,
          overflow: "hidden",
        }}
      >
        <Pressable
          onPress={() => {
            haptic("selection");
            setOpen((current) => !current);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: 52,
            paddingHorizontal: space.md,
            gap: space.sm,
          }}
        >
          <Text
            numberOfLines={1}
            style={[
              type.body,
              { flex: 1, color: selected ? palette.text : palette.textFaint },
            ]}
          >
            {selected?.label ?? placeholder ?? "…"}
          </Text>
          <Icon
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={palette.textFaint}
          />
        </Pressable>

        {open ? (
          <View
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.hairline,
            }}
          >
            {choices.length === 0 ? (
              <Text
                style={[
                  type.footnote,
                  {
                    color: palette.textMuted,
                    padding: space.lg,
                    textAlign: "center",
                  },
                ]}
              >
                {emptyHint ?? "—"}
              </Text>
            ) : (
              choices.map((choice) => {
                const active = choice.value === value;
                return (
                  <Pressable
                    key={choice.value}
                    disabled={choice.disabled}
                    onPress={() => {
                      haptic("selection");
                      onChange(choice.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                      minHeight: 48,
                      paddingRight: space.md,
                      paddingLeft: space.md + (choice.depth ?? 0) * 14,
                      backgroundColor: pressed
                        ? palette.accentSoft
                        : active
                          ? palette.accentSoft
                          : "transparent",
                      opacity: choice.disabled ? 0.4 : 1,
                    })}
                  >
                    <Text
                      numberOfLines={1}
                      style={[type.body, { flex: 1, color: palette.text }]}
                    >
                      {choice.label}
                    </Text>
                    {choice.hint ? (
                      <Text
                        style={[type.footnote, { color: palette.textFaint }]}
                      >
                        {choice.hint}
                      </Text>
                    ) : null}
                    {active ? (
                      <Icon name="checkmark" size={18} color={palette.accent} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}
      </View>
      {error ? (
        <Text style={[type.footnote, { color: palette.negative }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function FieldGroup({ children }: { children: ReactNode }) {
  return <View style={{ gap: space.lg }}>{children}</View>;
}

/** A labelled toggle, laid out like the other fields. */
export function SwitchField({
  label,
  hint,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const palette = usePalette();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: 52,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: palette.text }]}>{label}</Text>
        {hint ? (
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      <NativeSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      />
    </View>
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
  const palette = usePalette();

  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
        <Text style={[type.heading, numeric, { color: palette.text }]}>
          {display?.(value) ?? String(value)}
        </Text>
      </View>
      <NativeSlider
        value={value}
        onValueChange={onValueChange}
        min={min}
        max={max}
        step={step}
      />
    </View>
  );
}
