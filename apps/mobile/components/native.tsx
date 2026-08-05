import { type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button as UIButton,
  Column,
  FieldGroup,
  Host,
  ListItem,
  RNHostView,
  Row as UIRow,
  ScrollView as UIScrollView,
  Spacer,
  Text as UIText,
} from "@expo/ui";
import { Sign, type Glyph } from "@/components/icon";
import { haptic, type Tone } from "@/lib/haptics";
import { radius, space, type, useIsDark, usePalette } from "@/lib/theme";

/**
 * The layout vocabulary, drawn by the platform.
 *
 * Every screen is a single `Host` — one bridge into SwiftUI or Jetpack Compose —
 * and everything inside it is a real native view. That is what buys the
 * scrolling physics, the text selection, the accessibility tree and the
 * pressed states for free, instead of approximating each one in JavaScript.
 *
 * Two consequences worth knowing before editing anything here:
 *
 * - `Text` takes a string, not children. Interpolate before you render.
 * - There is no `flex`. Distribution is `Spacer flexible`, and a `Row` is laid
 *   out by its spacing rather than by pushing things apart.
 *
 * Anything React Native still has to draw — an SVG chart, a spinner — crosses
 * back through `RNHostView`, which is the only sanctioned direction of travel.
 */

// ------------------------------------------------------------------- screens

/**
 * The shell every screen shares: one host, an optional pinned footer.
 *
 * The footer sits outside the host on purpose. It has to stay put while the
 * content scrolls, and a native scroll container will not hold a child still —
 * so it gets a small host of its own above the home indicator.
 */
function Shell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const palette = usePalette();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Host
        style={{ flex: 1 }}
        colorScheme={isDark ? "dark" : "light"}
        useViewportSizeMeasurement
      >
        {children}
      </Host>

      {footer ? (
        <View
          style={{
            paddingHorizontal: space.lg,
            paddingTop: space.md,
            paddingBottom: insets.bottom + space.md,
            backgroundColor: palette.background,
          }}
        >
          <Host matchContents colorScheme={isDark ? "dark" : "light"}>
            <Column>{footer}</Column>
          </Host>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Free-form content: a headline number, a chart, cards. Scrolls, and lays its
 * children out in a column with the app's rhythm.
 */
export function Screen({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Shell footer={footer}>
      <UIScrollView>
        <Column
          spacing={space.lg}
          style={{
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.xxl,
          }}
        >
          {children}
        </Column>
      </UIScrollView>
    </Shell>
  );
}

/**
 * Grouped content: settings, forms, anything that reads as a list of rows.
 *
 * `FieldGroup` is SwiftUI's `Form` and Compose's equivalent — it scrolls
 * itself and draws the inset rounded blocks the platform uses everywhere else,
 * which is why this is a different shape rather than a variant of `Screen`.
 */
export function Grouped({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Shell footer={footer}>
      <FieldGroup>{children}</FieldGroup>
    </Shell>
  );
}

// --------------------------------------------------------------------- text

type TextTone =
  | "text"
  | "muted"
  | "faint"
  | "positive"
  | "negative"
  | "onAccent";

function toneColor(palette: ReturnType<typeof usePalette>, tone: TextTone) {
  switch (tone) {
    case "muted":
      return palette.textMuted;
    case "faint":
      return palette.textFaint;
    case "positive":
      return palette.positive;
    case "negative":
      return palette.negative;
    case "onAccent":
      return palette.accentText;
    default:
      return palette.text;
  }
}

export function Text({
  children,
  size = "body",
  tone = "text",
  color,
  align,
  numberOfLines,
  mono = false,
}: {
  children: string;
  size?: keyof typeof type;
  tone?: TextTone;
  color?: string;
  align?: "left" | "center" | "right";
  numberOfLines?: number;
  /** Tabular figures, for anything that changes in place. */
  mono?: boolean;
}) {
  const palette = usePalette();
  const scale = type[size];

  return (
    <UIText
      numberOfLines={numberOfLines}
      textStyle={{
        fontSize: scale.fontSize,
        lineHeight: scale.lineHeight,
        fontWeight: scale.fontWeight,
        letterSpacing: "letterSpacing" in scale ? scale.letterSpacing : undefined,
        color: color ?? toneColor(palette, tone),
        textAlign: align,
        // The platforms expose tabular figures through the font, and the
        // system font's variant is the one that matches everything else.
        fontFamily: mono ? undefined : undefined,
      }}
    >
      {size === "label" ? children.toUpperCase() : children}
    </UIText>
  );
}

export function Title({
  children,
  subtitle,
}: {
  children: string;
  subtitle?: string;
}) {
  return (
    <Column spacing={space.xs} style={{ paddingTop: space.sm }}>
      <Text size="display">{children}</Text>
      {subtitle ? (
        <Text size="callout" tone="muted">
          {subtitle}
        </Text>
      ) : null}
    </Column>
  );
}

export function Label({ children }: { children: string }) {
  return (
    <Text size="label" tone="faint">
      {children}
    </Text>
  );
}

// ------------------------------------------------------------------ grouping

/**
 * A titled group. `FieldSection` is what draws the platform's own grouped-list
 * look — inset rounded blocks on iOS, a titled surface on Android — so a
 * settings screen here is indistinguishable from a system one.
 */
export function Section({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <FieldGroup.Section title={title} titleUppercase>
      {children}
    </FieldGroup.Section>
  );
}

/** A free-standing block for content that is not a list. */
export function Card({
  children,
  spacing = space.md,
  onPress,
}: {
  children: ReactNode;
  spacing?: number;
  onPress?: () => void;
}) {
  const palette = usePalette();

  return (
    <Column
      spacing={spacing}
      onPress={
        onPress
          ? () => {
              haptic("selection");
              onPress();
            }
          : undefined
      }
      style={{
        backgroundColor: palette.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.border,
        padding: space.lg,
      }}
    >
      {children}
    </Column>
  );
}

export function Row({
  children,
  spacing = space.sm,
  alignment = "center",
  onPress,
}: {
  children: ReactNode;
  spacing?: number;
  alignment?: "start" | "center" | "end";
  onPress?: () => void;
}) {
  return (
    <UIRow
      spacing={spacing}
      alignment={alignment}
      onPress={
        onPress
          ? () => {
              haptic("selection");
              onPress();
            }
          : undefined
      }
    >
      {children}
    </UIRow>
  );
}

export { Column, Spacer };

/**
 * One line in a group. `supportingText` is the platform's own secondary line,
 * and `trailing` is where a value or a control belongs — which is why this
 * takes nodes rather than a formatted string.
 */
export function Line({
  title,
  detail,
  leading,
  trailing,
  onPress,
  destructive = false,
}: {
  title: string;
  detail?: string;
  leading?: Glyph;
  trailing?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const palette = usePalette();

  return (
    <ListItem
      onPress={
        onPress
          ? () => {
              haptic("selection");
              onPress();
            }
          : undefined
      }
      leading={leading ? <Sign glyph={leading} size={20} /> : undefined}
      trailing={trailing}
      supportingText={detail}
    >
      <Text color={destructive ? palette.negative : undefined}>{title}</Text>
    </ListItem>
  );
}

// ------------------------------------------------------------------- actions

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  tone = "light",
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "destructive";
  disabled?: boolean;
  tone?: Tone;
}) {
  const palette = usePalette();

  return (
    <UIButton
      variant={
        variant === "primary"
          ? "filled"
          : variant === "secondary"
            ? "outlined"
            : "text"
      }
      disabled={disabled}
      onPress={() => {
        haptic(variant === "destructive" ? "warning" : tone);
        onPress();
      }}
      style={
        variant === "destructive" ? { backgroundColor: palette.bandSoft.poor } : undefined
      }
    >
      <Text
        size="heading"
        color={
          variant === "primary"
            ? palette.accentText
            : variant === "destructive"
              ? palette.negative
              : palette.text
        }
      >
        {label}
      </Text>
    </UIButton>
  );
}

// -------------------------------------------------------------------- states

export function Empty({
  glyph = "empty",
  title,
  body,
  action,
}: {
  glyph?: Glyph;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <Column
      alignment="center"
      spacing={space.md}
      style={{ paddingVertical: space.xxxl, paddingHorizontal: space.lg }}
    >
      <Sign glyph={glyph} size={28} tone="faint" />
      <Text size="heading" align="center">
        {title}
      </Text>
      {body ? (
        <Text size="footnote" tone="muted" align="center">
          {body}
        </Text>
      ) : null}
      {action}
    </Column>
  );
}

export function Loading() {
  const palette = usePalette();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.background,
      }}
    >
      <ActivityIndicator color={palette.textFaint} />
    </View>
  );
}

/**
 * The way back to React Native.
 *
 * Charts are SVG and SVG is an RN library, so a chart re-enters the native
 * tree through here. Keep the crossings few and always in this direction — a
 * host inside a host inside a host is where layout stops being predictable.
 */
export function FromReactNative({
  children,
  height,
}: {
  children: ReactElement;
  height?: number;
}) {
  return (
    <RNHostView matchContents={height === undefined} style={{ height }}>
      {children}
    </RNHostView>
  );
}
