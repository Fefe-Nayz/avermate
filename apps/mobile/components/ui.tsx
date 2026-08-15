import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/icon";
import { haptic, type Tone } from "@/lib/haptics";
import { useInteractionPreferences } from "@/lib/interaction-preferences";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

/**
 * The layout vocabulary.
 *
 * Six pieces — screen, section, card, row, label, action — and every screen in
 * the app is built from them. Keeping the set this small is what makes the
 * result look designed rather than assembled.
 */

export function Screen({
  children,
  scroll = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { compactMode } = useInteractionPreferences();

  const body = scroll ? (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: compactMode ? space.md : space.lg,
        paddingBottom: insets.bottom + (footer ? space.xxxl * 2 : space.xxxl),
        gap: compactMode ? space.md : space.lg,
      }}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={{
        flex: 1,
        paddingHorizontal: compactMode ? space.md : space.lg,
        gap: compactMode ? space.md : space.lg,
      }}
    >
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {body}
      {footer ? (
        // Pinned above the home indicator so a primary action stays reachable
        // however long the form gets.
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: space.lg,
            paddingTop: space.md,
            paddingBottom: insets.bottom + space.md,
            backgroundColor: palette.background,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: palette.hairline,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function Title({
  children,
  subtitle,
}: {
  children: string;
  subtitle?: string;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: space.xs, paddingTop: space.sm }}>
      <Text style={[type.display, { color: palette.text }]}>{children}</Text>
      {subtitle ? (
        <Text style={[type.callout, { color: palette.textMuted }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function Label({ children }: { children: string }) {
  const palette = usePalette();
  return (
    <Text style={[type.label, { color: palette.textFaint }]}>{children}</Text>
  );
}

export function Section({
  title,
  icon,
  description,
  action,
  children,
}: {
  title?: string;
  icon?: IconName;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: space.sm }}>
      {title || action ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: space.md,
            paddingHorizontal: space.xs,
          }}
        >
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space.sm,
            }}
          >
            {icon ? (
              <View style={{ marginTop: 2 }}>
                <Icon name={icon} size={15} color={palette.textMuted} />
              </View>
            ) : null}
            <View style={{ flex: 1, gap: 2 }}>
              {title ? (
                // The web's lifted section titles: text-sm font-medium.
                <Text style={[type.section, { color: palette.text }]}>
                  {title}
                </Text>
              ) : null}
              {description ? (
                <Text style={[type.footnote, { color: palette.textMuted }]}>
                  {description}
                </Text>
              ) : null}
            </View>
          </View>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const palette = usePalette();
  const { compactMode } = useInteractionPreferences();
  return (
    <View
      style={[
        {
          backgroundColor: palette.surface,
          // The web card: rounded-xl with a one-pixel border.
          borderRadius: radius.xl,
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          padding: padded ? (compactMode ? space.md : space.lg) : 0,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A tappable list row. `leading` is drawn at a fixed width so rows align. */
export function Row({
  title,
  subtitle,
  trailing,
  leading,
  onPress,
  href,
  indent = 0,
  muted = false,
  first = false,
  destructive = false,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  leading?: ReactNode;
  onPress?: () => void;
  href?: string;
  indent?: number;
  muted?: boolean;
  first?: boolean;
  destructive?: boolean;
}) {
  const palette = usePalette();
  const { compactMode } = useInteractionPreferences();

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: compactMode ? 44 : 48,
        paddingVertical: space.sm,
        paddingRight: space.lg,
        paddingLeft: space.lg + indent * 14,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: palette.hairline,
      }}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={[
            // The web row: text-sm font-medium titles.
            muted ? type.label : type.callout,
            {
              color: destructive
                ? palette.negative
                : muted
                  ? palette.textFaint
                  : palette.text,
            },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[type.footnote, { color: palette.textMuted }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {onPress || href ? (
        <Icon name="chevron-forward" size={16} color={palette.textFaint} />
      ) : null}
    </View>
  );

  if (!onPress && !href) return content;

  return (
    <Pressable
      onPress={() => {
        haptic("selection");
        onPress?.();
      }}
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.accentSoft : "transparent",
      })}
    >
      {content}
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  tone = "light",
  icon,
  size = "default",
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive";
  disabled?: boolean;
  loading?: boolean;
  tone?: Tone;
  icon?: IconName;
  size?: "default" | "sm";
}) {
  const palette = usePalette();

  const background =
    variant === "primary"
      ? palette.accent
      : variant === "secondary"
        ? palette.accentSoft
        : variant === "destructive"
          ? palette.negative
          : "transparent";
  const foreground =
    variant === "primary" || variant === "destructive"
      ? palette.accentText
      : variant === "ghost"
        ? palette.textMuted
        : palette.text;

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        haptic(tone);
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        // The web's touch heights (h-11 / h-9) on the web's rounded-md.
        minHeight: size === "sm" ? 36 : 44,
        paddingHorizontal: size === "sm" ? space.md : space.lg,
        borderRadius: radius.md,
        borderCurve: "continuous" as const,
        backgroundColor: background,
        borderWidth: variant === "outline" ? StyleSheet.hairlineWidth : 0,
        borderColor: palette.border,
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : icon ? (
        <Icon name={icon} size={size === "sm" ? 15 : 16} color={foreground} />
      ) : null}
      <Text
        style={[
          size === "sm" ? type.callout : type.body,
          { color: foreground, fontWeight: "500" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Empty({
  icon = "sparkles-outline",
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.xxl,
        paddingHorizontal: space.lg,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: palette.border,
      }}
    >
      <Icon name={icon} size={26} color={palette.textFaint} />
      <Text
        style={[type.heading, { color: palette.text, textAlign: "center" }]}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={[
            type.footnote,
            { color: palette.textMuted, textAlign: "center", maxWidth: 280 },
          ]}
        >
          {body}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

/**
 * A screen heading the way the web draws one: the page title in plain
 * text-2xl semibold with a muted supporting line, and room for one action on
 * the right. The web puts no icon on its titles, so neither does this —
 * `icon` is still accepted while call sites migrate, and simply not drawn.
 */
export function Heading({
  icon: _icon,
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: space.md,
        paddingTop: space.sm,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.title, { color: palette.text }]}>{title}</Text>
        {description ? (
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/** A small pill, the web's badge vocabulary. */
export function Badge({
  label,
  icon,
  toneColor = "neutral",
}: {
  label: string;
  icon?: IconName;
  toneColor?: "neutral" | "accent" | "positive" | "negative";
}) {
  const palette = usePalette();
  const color =
    toneColor === "accent"
      ? palette.accent
      : toneColor === "positive"
        ? palette.positive
        : toneColor === "negative"
          ? palette.negative
          : palette.textMuted;
  const background =
    toneColor === "accent"
      ? palette.accentSoft
      : toneColor === "neutral"
        ? palette.surface
        : color + "22";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        // The web badge: rounded-md, text-xs medium.
        borderRadius: radius.sm,
        borderCurve: "continuous",
        backgroundColor: background,
        borderWidth: toneColor === "neutral" ? StyleSheet.hairlineWidth : 0,
        borderColor: palette.border,
      }}
    >
      {icon ? <Icon name={icon} size={11} color={color} /> : null}
      <Text style={[type.label, { color, textTransform: "none" }]}>
        {label}
      </Text>
    </View>
  );
}

/** A bordered figure card, the web's stat tile: label above, number below. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        flex: 1,
        gap: 4,
        padding: space.md,
        borderRadius: radius.xl,
        borderCurve: "continuous",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
      <Text
        style={[
          type.heading,
          numeric,
          { fontSize: 18, lineHeight: 24, color: palette.text },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {hint ? (
        <Text style={[type.footnote, { color: palette.textMuted }]}>
          {hint}
        </Text>
      ) : null}
    </View>
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

/** A bar that fills toward a goal. Capped, because overshooting is still done. */
export function ProgressBar({
  value,
  done = false,
}: {
  value: number;
  done?: boolean;
}) {
  const palette = usePalette();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  return (
    <View
      style={{
        height: 8,
        borderRadius: radius.pill,
        backgroundColor: palette.accentSoft,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: "100%",
          borderRadius: radius.pill,
          backgroundColor: done ? palette.positive : palette.accent,
        }}
      />
    </View>
  );
}

export function Divider() {
  const palette = usePalette();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: palette.hairline,
      }}
    />
  );
}

/** A horizontally scrolling row of chips. Used for period and year scope. */
export function ChipRail({
  items,
  activeId,
  onSelect,
}: {
  items: Array<{ id: string; label: string; icon?: IconName }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const palette = usePalette();
  if (items.length <= 1) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg }}
      style={{ marginHorizontal: -space.lg }}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Pressable
            key={item.id}
            onPress={() => {
              haptic("selection");
              onSelect(item.id);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              minHeight: 32,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: active ? palette.accentSoft : palette.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.border,
            }}
          >
            {item.icon ? (
              <Icon
                name={item.icon}
                size={13}
                color={active ? palette.text : palette.textMuted}
              />
            ) : null}
            <Text
              style={[
                type.footnote,
                {
                  color: active ? palette.text : palette.textMuted,
                  fontWeight: active ? "600" : "500",
                },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * A line of explanation under a group. Used where a control needs a sentence
 * that would not fit as a field label — a passing mark, a data export.
 */
export function Note({ children }: { children: string }) {
  const palette = usePalette();
  return (
    <Text
      style={[
        type.footnote,
        { color: palette.textMuted, paddingHorizontal: space.xs },
      ]}
    >
      {children}
    </Text>
  );
}

/** The same, in the colour of a problem. */
export function Problem({ children }: { children: string }) {
  const palette = usePalette();
  return (
    <Text
      style={[
        type.footnote,
        { color: palette.negative, paddingHorizontal: space.xs },
      ]}
    >
      {children}
    </Text>
  );
}

/** The same, in the colour of a confirmation. */
export function Confirmation({ children }: { children: string }) {
  const palette = usePalette();
  return (
    <Text
      style={[
        type.footnote,
        { color: palette.positive, paddingHorizontal: space.xs },
      ]}
    >
      {children}
    </Text>
  );
}
