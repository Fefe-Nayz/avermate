import { Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space, type, usePalette, type Palette } from "@/lib/theme";
import { useYear } from "@/components/year-provider";

/**
 * The web's tone table: the banner itself takes the severity wash while the
 * title stays in plain ink and the message in the muted weight.
 */
function toneStyle(
  tone: string,
  palette: Palette,
): { icon: IconName; background: string } {
  switch (tone) {
    case "success":
      return { icon: "checkmark-circle", background: palette.bandSoft.good };
    case "warning":
      return { icon: "warning", background: palette.bandSoft.fair };
    case "danger":
      return { icon: "alert-circle", background: palette.bandSoft.poor };
    default:
      return { icon: "info", background: palette.accentSoft };
  }
}

/** Product notices. One at a time, dismissible, and never over the content. */
export function AnnouncementBanner() {
  const palette = usePalette();
  const { yearId } = useYear();
  const active = useQuery({
    ...orpc.announcements.active.queryOptions({
      input: { yearId: yearId ?? "" },
    }),
    enabled: Boolean(yearId),
  });
  const dismiss = useMutation({
    ...orpc.announcements.dismiss.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.active.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.history.key(),
        }),
      ]);
    },
  });
  const announcement = active.data?.[0];
  if (!announcement) return null;

  const tone = toneStyle(announcement.tone, palette);

  return (
    <View
      accessibilityRole="alert"
      style={{
        paddingTop: space.sm,
        paddingHorizontal: space.lg,
        paddingBottom: space.sm,
        backgroundColor: tone.background,
        borderBottomColor: palette.hairline,
        borderBottomWidth: 1,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          gap: space.md,
          alignItems: "flex-start",
        }}
      >
        <View style={{ marginTop: 2 }}>
          <Icon name={tone.icon} size={16} color={palette.text} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            selectable
            style={[type.callout, { color: palette.text, fontWeight: "500" }]}
          >
            {announcement.title}
          </Text>
          <Text
            selectable
            numberOfLines={2}
            style={[type.footnote, { color: palette.textMuted }]}
          >
            {announcement.message}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Dismiss")}
          hitSlop={12}
          disabled={dismiss.isPending}
          onPress={() => {
            haptic("light");
            dismiss.mutate({
              announcementId: announcement.id,
              yearId: yearId ?? undefined,
            });
          }}
        >
          <Icon name="close" size={20} color={palette.textFaint} />
        </Pressable>
      </View>
    </View>
  );
}
