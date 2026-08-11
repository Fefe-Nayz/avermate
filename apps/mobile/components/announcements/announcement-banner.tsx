import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { space, type, usePalette } from "@/lib/theme";

/** The newest unread announcement, kept outside route content. */
export function AnnouncementBanner() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const active = useQuery(orpc.announcements.active.queryOptions());
  const dismiss = useMutation({
    ...orpc.announcements.dismiss.mutationOptions(),
    onSuccess: async () => {
      haptic("light");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.active.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.history.queryKey(),
        }),
      ]);
    },
  });
  const announcement = active.data?.[0];
  if (!announcement) return null;

  const tone =
    announcement.tone === "danger"
      ? palette.negative
      : announcement.tone === "success"
        ? palette.positive
        : palette.text;

  return (
    <View
      accessibilityRole="alert"
      style={{
        paddingTop: insets.top + space.sm,
        paddingHorizontal: space.lg,
        paddingBottom: space.sm,
        backgroundColor: palette.surface,
        borderBottomColor: palette.hairline,
        borderBottomWidth: 1,
      }}
    >
      <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
        <Ionicons name="megaphone-outline" size={19} color={tone} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text selectable style={[type.callout, { color: tone, fontWeight: "700" }]}>
            {announcement.title}
          </Text>
          <Text selectable numberOfLines={2} style={[type.footnote, { color: palette.textMuted }]}>
            {announcement.message}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={12}
          disabled={dismiss.isPending}
          onPress={() => dismiss.mutate({ announcementId: announcement.id })}
        >
          <Ionicons name="close" size={20} color={palette.textFaint} />
        </Pressable>
      </View>
    </View>
  );
}
