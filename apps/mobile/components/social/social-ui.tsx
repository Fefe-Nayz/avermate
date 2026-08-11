import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Card } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

export function PrivacyBoundaryNotice({ compact = false }: { compact?: boolean }) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="summary"
      style={{
        flexDirection: "row",
        gap: space.md,
        padding: compact ? space.md : space.lg,
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: palette.accentSoft,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.accent,
      }}
    >
      <Ionicons name="shield-checkmark-outline" size={20} color={palette.accent} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={[type.heading, { color: palette.text }]}>
          {t("Shared by choice")}
        </Text>
        <Text selectable style={[type.footnote, { color: palette.textMuted }]}>
          {t(
            "A missing permission always means no access. Social views never expose complete grades, subject names, comments, dates or your email.",
          )}
        </Text>
      </View>
    </View>
  );
}

export function SocialIdentity({
  displayName,
  avatar,
  handle,
  secondary,
}: {
  displayName: string;
  avatar?: string | null;
  handle?: string | null;
  secondary?: string;
}) {
  const palette = usePalette();
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      {avatar ? (
        <Image
          source={{ uri: avatar }}
          accessibilityLabel={t("Profile picture for {name}", { name: displayName })}
          style={{ width: 46, height: 46, borderRadius: radius.pill }}
          contentFit="cover"
        />
      ) : (
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.accentSoft,
          }}
        >
          <Text style={[type.heading, { color: palette.text }]}>{initials || "?"}</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text selectable numberOfLines={1} style={[type.heading, { color: palette.text }]}>
          {displayName}
        </Text>
        {handle || secondary ? (
          <Text selectable numberOfLines={1} style={[type.footnote, { color: palette.textMuted }]}>
            {handle ? `@${handle}` : secondary}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function SocialMetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  const palette = usePalette();
  return (
    <Card style={{ flexGrow: 1, flexBasis: "46%", gap: space.sm }}>
      <Text selectable style={[type.label, { color: palette.textFaint }]}>
        {label}
      </Text>
      <Text selectable style={[type.title, numeric, { color: palette.text }]}>
        {value}
      </Text>
      {description ? (
        <Text selectable style={[type.footnote, { color: palette.textMuted }]}>
          {description}
        </Text>
      ) : null}
    </Card>
  );
}

export function SocialNavigation({ current }: { current: string }) {
  const router = useRouter();
  const palette = usePalette();
  const items = [
    { key: "overview", label: t("Overview"), path: "/social" },
    { key: "friends", label: t("Friends"), path: "/social/friends" },
    { key: "groups", label: t("Groups"), path: "/social/groups" },
    { key: "sharing", label: t("Sharing"), path: "/social/profile" },
    { key: "updates", label: t("Updates"), path: "/social/notifications" },
  ] as const;
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
      {items.map((item) => {
        const active = item.key === current;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptic("selection");
              router.replace(item.path);
            }}
            style={{
              minHeight: 40,
              justifyContent: "center",
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: active ? palette.accent : palette.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: active ? palette.accent : palette.border,
            }}
          >
            <Text style={[type.callout, { color: active ? palette.accentText : palette.textMuted }]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function InlineActions({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{children}</View>;
}
