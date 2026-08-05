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
import { Ionicons } from "@expo/vector-icons";
import { haptic, type Tone } from "@/lib/haptics";
import { radius, space, type, usePalette } from "@/lib/theme";

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

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: space.lg,
        paddingBottom: insets.bottom + (footer ? space.xxxl * 2 : space.xxxl),
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, paddingHorizontal: space.lg, gap: space.lg }}>
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

export function Title({ children, subtitle }: { children: string; subtitle?: string }) {
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
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space.sm }}>
      {title || action ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space.xs,
          }}
        >
          {title ? <Label>{title}</Label> : <View />}
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
  return (
    <View
      style={[
        {
          backgroundColor: palette.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          padding: padded ? space.lg : 0,
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

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: 52,
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
            muted ? type.label : type.body,
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
        <Ionicons
          name="chevron-forward"
          size={16}
          color={palette.textFaint}
        />
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
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  disabled?: boolean;
  loading?: boolean;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const palette = usePalette();

  const background =
    variant === "primary"
      ? palette.accent
      : variant === "secondary"
        ? palette.accentSoft
        : "transparent";
  const foreground =
    variant === "primary"
      ? palette.accentText
      : variant === "destructive"
        ? palette.negative
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
        minHeight: 52,
        paddingHorizontal: space.lg,
        borderRadius: radius.md,
        backgroundColor: background,
        borderWidth: variant === "ghost" ? StyleSheet.hairlineWidth : 0,
        borderColor: palette.border,
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={foreground} />
      ) : null}
      <Text style={[type.heading, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Empty({
  icon = "sparkles-outline",
  title,
  body,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
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
        paddingVertical: space.xxxl,
        paddingHorizontal: space.lg,
      }}
    >
      <Ionicons name={icon} size={28} color={palette.textFaint} />
      <Text style={[type.heading, { color: palette.text, textAlign: "center" }]}>
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
        height: 6,
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
  items: Array<{ id: string; label: string; icon?: keyof typeof Ionicons.glyphMap }>;
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
              minHeight: 38,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: active ? palette.accent : palette.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: active ? palette.accent : palette.border,
            }}
          >
            {item.icon ? (
              <Ionicons
                name={item.icon}
                size={14}
                color={active ? palette.accentText : palette.textMuted}
              />
            ) : null}
            <Text
              style={[
                type.callout,
                { color: active ? palette.accentText : palette.textMuted },
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
