import { StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Icon, type IconName } from "@/components/icon";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Empty,
  Loading,
  Screen,
  Section,
} from "@/components/ui";
import { formatDate } from "@/components/format";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { radius, space, type, usePalette, type Palette } from "@/lib/theme";
import { useYear } from "@/components/year-provider";

/**
 * The web's tone table: one icon and one soft wash per severity, while the
 * text itself stays in plain ink.
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

/** Read and unread product messages retained as a per-user inbox. */
export function AnnouncementsScreen() {
  const palette = usePalette();
  const { yearId } = useYear();
  const history = useQuery({
    ...orpc.announcements.history.queryOptions({
      input: { yearId: yearId ?? "" },
    }),
    enabled: Boolean(yearId),
  });
  const dismiss = useMutation({
    ...orpc.announcements.dismiss.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.history.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.active.key(),
        }),
      ]);
    },
  });

  if (history.isLoading) return <Loading />;
  const messages = history.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t("Announcements") }} />
      <Screen>
        {messages.length === 0 ? (
          <Section>
            <Empty
              icon="mail-open-outline"
              title={t("No announcements")}
              body={t(
                "Product updates and important notices will appear here.",
              )}
            />
          </Section>
        ) : (
          <Section>
            <Card padded={false}>
              {messages.map((message, index) => {
                const tone = toneStyle(message.tone, palette);
                return (
                  <View
                    key={message.id}
                    style={{
                      flexDirection: "row",
                      gap: space.md,
                      padding: space.lg,
                      borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                      borderTopColor: palette.hairline,
                      backgroundColor: message.dismissed
                        ? "transparent"
                        : palette.accent + "08",
                    }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: radius.md,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: tone.background,
                      }}
                    >
                      <Icon name={tone.icon} size={16} color={palette.text} />
                    </View>
                    <View style={{ flex: 1, gap: space.xs }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: space.sm,
                        }}
                      >
                        <Text
                          selectable
                          style={[type.heading, { color: palette.text }]}
                        >
                          {message.title}
                        </Text>
                        {!message.dismissed ? (
                          <Badge label={t("New")} toneColor="accent" />
                        ) : null}
                      </View>
                      <Text
                        selectable
                        style={[type.body, { color: palette.textMuted }]}
                      >
                        {message.message}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: space.sm,
                          paddingTop: space.xs,
                        }}
                      >
                        <Text
                          style={[type.footnote, { color: palette.textMuted }]}
                        >
                          {formatDate(new Date(message.createdAt))}
                        </Text>
                        {!message.dismissed && message.currentlyActive ? (
                          <Button
                            label={t("Mark as read")}
                            variant="ghost"
                            size="sm"
                            loading={dismiss.isPending}
                            onPress={() =>
                              dismiss.mutate({
                                announcementId: message.id,
                                yearId: yearId ?? undefined,
                              })
                            }
                          />
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>
          </Section>
        )}
      </Screen>
    </>
  );
}
