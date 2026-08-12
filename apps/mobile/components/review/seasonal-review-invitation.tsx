import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon } from "@/components/icon";
import { useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { useYear } from "@/components/year-provider";
import { useSession } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { localUserKey } from "@/lib/local-settings";
import { orpc } from "@/lib/orpc";
import { radius, space, type, usePalette } from "@/lib/theme";
import { yearReviewWindowKey } from "@/lib/year-review-window";

/** Seasonal and account-scoped: no status request is made outside a window. */
export function SeasonalReviewInvitation() {
  const palette = usePalette();
  const router = useRouter();
  const session = useSession();
  const { now, year, yearId } = useYear();
  const reviewKey = year
    ? yearReviewWindowKey(
        new Date(now),
        new Date(year.startsAt),
        new Date(year.endsAt),
      )
    : null;
  const dismissalKey =
    session.data?.user.id && yearId && reviewKey
      ? localUserKey(
          session.data.user.id,
          `review-dismissed.${yearId}.${reviewKey}`,
        )
      : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const status = useQuery({
    ...orpc.review.status.queryOptions({
      input: { yearId: yearId ?? "", reviewKey: reviewKey ?? "annual" },
    }),
    enabled: Boolean(yearId && reviewKey),
  });

  useEffect(() => {
    let alive = true;
    setLoadedKey(null);
    setDismissed(false);
    if (!dismissalKey) return;
    void SecureStore.getItemAsync(dismissalKey).then((value) => {
      if (!alive) return;
      setDismissed(value === "1");
      setLoadedKey(dismissalKey);
    });
    return () => {
      alive = false;
    };
  }, [dismissalKey]);

  if (
    !year ||
    !yearId ||
    !reviewKey ||
    !dismissalKey ||
    loadedKey !== dismissalKey ||
    dismissed ||
    !status.data?.available ||
    status.data.seen
  ) {
    return null;
  }

  return (
    <View
      accessibilityLabel={t("Year recap available")}
      style={{
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: palette.surfaceRaised,
        borderWidth: 1,
        borderColor: palette.border,
        padding: space.lg,
        gap: space.md,
        boxShadow: "0 12px 30px rgba(0,0,0,.12)",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.md,
        }}
      >
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.accentSoft,
          }}
        >
          <Icon name="sparkles" size={20} color={palette.text} />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text selectable style={[type.heading, { color: palette.text }]}>
            {t("Your {year} recap is ready", { year: year.name })}
          </Text>
          <Text
            selectable
            style={[type.footnote, { color: palette.textMuted }]}
          >
            {t(
              "{count} grades, your strongest subjects, your best run and the title you earned.",
              {
                count: String(status.data.gradeCount),
              },
            )}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={t("Dismiss")}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => {
            haptic("light");
            setDismissed(true);
            void SecureStore.setItemAsync(dismissalKey, "1");
          }}
          style={{ padding: space.xs }}
        >
          <Icon name="close" size={18} color={palette.textFaint} />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptic("medium");
          router.push({
            pathname: "/review",
            params: { play: "1", yearId },
          });
        }}
        style={{
          minHeight: 48,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.accent,
        }}
      >
        <Text style={[type.heading, { color: palette.accentText }]}>
          {t("Play my recap")}
        </Text>
      </Pressable>
    </View>
  );
}
