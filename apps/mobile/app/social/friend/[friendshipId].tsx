import { Alert, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SocialRouteGate } from "@/components/social/social-gate";
import {
  PrivacyBoundaryNotice,
  SocialIdentity,
} from "@/components/social/social-ui";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { educationBandLabel } from "@/components/social/social-copy";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";

export default function SharedFriendProfile() {
  const { friendshipId } = useLocalSearchParams<{ friendshipId: string }>();
  const router = useRouter();
  const palette = usePalette();
  const preview = useQuery({
    ...orpc.social.profile.preview.queryOptions({ input: { friendshipId } }),
    enabled: Boolean(friendshipId),
  });

  const leave = useMutation({
    ...orpc.social.friends.remove.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.friends.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.circles.list.queryKey(),
        }),
      ]);
      router.replace("/social/friends");
    },
  });
  const block = useMutation({
    ...orpc.social.blocks.create.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.friends.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.blocks.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.circles.list.queryKey(),
        }),
      ]);
      router.replace("/social/friends");
    },
  });

  return (
    <SocialRouteGate>
      <>
        <Stack.Screen options={{ title: t("Shared profile") }} />
        <Screen>
          <PrivacyBoundaryNotice compact />
          {preview.isLoading ? (
            <Loading />
          ) : preview.isError || !preview.data ? (
            <Empty
              icon="lock-closed-outline"
              title={t("This profile is no longer available")}
              body={t(
                "The friendship, profile status or sharing permissions may have changed.",
              )}
              action={
                <Button
                  label={t("Back to friends")}
                  onPress={() => router.replace("/social/friends")}
                />
              }
            />
          ) : (
            <>
              <Section>
                <Card style={{ gap: space.lg }}>
                  <SocialIdentity
                    displayName={
                      preview.data.profile.displayName ?? t("Private friend")
                    }
                    avatar={preview.data.profile.avatar}
                  />
                  {preview.data.profile.bio ? (
                    <Text
                      selectable
                      style={[type.body, { color: palette.text }]}
                    >
                      {preview.data.profile.bio}
                    </Text>
                  ) : null}
                  {preview.data.profile.educationBand ? (
                    <Text
                      selectable
                      style={[type.footnote, { color: palette.textMuted }]}
                    >
                      {educationBandLabel(preview.data.profile.educationBand)}
                    </Text>
                  ) : null}
                </Card>
              </Section>

              <Section title={t("Privacy boundary")}>
                <Note>
                  {t(
                    "Only fields this friend explicitly granted to you are present. Empty fields are not inferred or replaced with account data.",
                  )}
                </Note>
                <Button
                  label={t("Choose what I share with this friend")}
                  variant="secondary"
                  onPress={() =>
                    router.push({
                      pathname: "/social/grants",
                      params: {
                        audience: "specific_user",
                        audienceId: friendshipId,
                        label:
                          preview.data.profile.displayName ?? t("this friend"),
                      },
                    })
                  }
                />
              </Section>

              <Section title={t("Relationship actions")}>
                <Button
                  label={t("Remove friendship")}
                  variant="secondary"
                  loading={leave.isPending}
                  onPress={() =>
                    Alert.alert(
                      t("Remove this friend?"),
                      t(
                        "Both profiles stop being shared and circle membership is removed.",
                      ),
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("Remove"),
                          style: "destructive",
                          onPress: () => leave.mutate({ friendshipId }),
                        },
                      ],
                    )
                  }
                />
                <Button
                  label={t("Block account")}
                  variant="destructive"
                  loading={block.isPending}
                  onPress={() =>
                    Alert.alert(
                      t("Block this account?"),
                      t(
                        "Friendship, requests, circle membership and sharing stop in both directions.",
                      ),
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("Block"),
                          style: "destructive",
                          onPress: () =>
                            block.mutate({
                              source: "friendship",
                              sourceId: friendshipId,
                            }),
                        },
                      ],
                    )
                  }
                />
                <Button
                  label={t("Report a safety concern")}
                  variant="ghost"
                  onPress={() =>
                    router.push({
                      pathname: "/social/report",
                      params: { source: "friendship", sourceId: friendshipId },
                    })
                  }
                />
                {leave.isError || block.isError ? (
                  <Problem>
                    {t(
                      "That action could not be completed. Refresh and try again.",
                    )}
                  </Problem>
                ) : null}
              </Section>
            </>
          )}
        </Screen>
      </>
    </SocialRouteGate>
  );
}
