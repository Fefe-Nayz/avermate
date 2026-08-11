import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Screen,
  Section,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { radius, space, type, usePalette } from "@/lib/theme";
import { useYear } from "@/components/year-provider";

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
          queryKey: orpc.announcements.active.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.history.key(),
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
              body={t("Important product messages will appear here.")}
            />
          </Section>
        ) : (
          <Section title={t("Inbox")}>
            <View style={{ gap: space.md }}>
              {messages.map((message) => {
                const tone =
                  message.tone === "danger"
                    ? palette.negative
                    : message.tone === "success"
                      ? palette.positive
                      : palette.text;
                return (
                  <Card key={message.id}>
                    <View style={{ flexDirection: "row", gap: space.md }}>
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: radius.pill,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: palette.accentSoft,
                        }}
                      >
                        <Ionicons
                          name="megaphone-outline"
                          size={18}
                          color={tone}
                        />
                      </View>
                      <View style={{ flex: 1, gap: space.sm }}>
                        <View style={{ gap: 2 }}>
                          <Text
                            selectable
                            style={[type.heading, { color: tone }]}
                          >
                            {message.title}
                          </Text>
                          <Text
                            selectable
                            style={[type.body, { color: palette.textMuted }]}
                          >
                            {message.message}
                          </Text>
                        </View>
                        <Text
                          style={[type.footnote, { color: palette.textFaint }]}
                        >
                          {new Date(message.createdAt).toLocaleDateString()}
                        </Text>
                        {!message.dismissed && message.currentlyActive ? (
                          <Button
                            label={t("Mark as read")}
                            variant="ghost"
                            loading={dismiss.isPending}
                            onPress={() =>
                              dismiss.mutate({
                                announcementId: message.id,
                                yearId: yearId ?? undefined,
                              })
                            }
                          />
                        ) : (
                          <Note>{t("Read")}</Note>
                        )}
                      </View>
                    </View>
                  </Card>
                );
              })}
            </View>
          </Section>
        )}
      </Screen>
    </>
  );
}
