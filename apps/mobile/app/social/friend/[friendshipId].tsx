import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  SharedAverageText,
  SocialIdentity,
} from "@/components/social/social-ui";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";

/**
 * One friend: who they are, then the real averages they chose to share, on
 * their own scale. The destructive actions sit at the end.
 */
export default function FriendDetail() {
  const router = useRouter();
  const { friendshipId } = useLocalSearchParams<{ friendshipId: string }>();
  const detail = useQuery({
    ...orpc.social.friends.detail.queryOptions({
      input: { friendshipId: friendshipId ?? "" },
    }),
    enabled: Boolean(friendshipId),
  });

  const remove = useMutation({
    ...orpc.social.friends.remove.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.queryKey(),
      });
      router.back();
    },
  });
  const block = useMutation({
    ...orpc.social.blocks.create.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.friends.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.blocks.list.queryKey(),
        }),
      ]);
      router.back();
    },
  });

  const friend = detail.data;

  return (
    <>
      <Stack.Screen options={{ title: friend?.name ?? t("Friend") }} />
      <Screen>
        {detail.isLoading ? (
          <Loading />
        ) : detail.isError || !friend ? (
          <Empty
            icon="person-outline"
            title={t("This friend could not be found")}
            body={t("The friendship may have been removed.")}
          />
        ) : (
          <>
            <Card>
              <SocialIdentity
                name={friend.name}
                handle={friend.handle}
                avatar={friend.avatar}
              />
            </Card>

            {friend.sharing ? (
              <>
                {friend.sharing.shareGeneralAverage ? (
                  <Section title={t("General average")}>
                    <Card
                      style={{
                        alignItems: "center",
                        gap: space.xs,
                        paddingVertical: space.xl,
                      }}
                    >
                      <SharedAverageText
                        ratio={friend.sharing.generalAverage}
                        scale={friend.sharing.year.scale}
                        decimals={friend.sharing.year.decimals}
                        size="title"
                      />
                      <Note>
                        {t("Computed from {year}", {
                          year: friend.sharing.year.name,
                        })}
                      </Note>
                    </Card>
                  </Section>
                ) : null}

                {friend.sharing.subjects.length ? (
                  <Section title={t("Shared subjects")}>
                    <Card padded={false}>
                      {friend.sharing.subjects.map((subject, index) => (
                        <Row
                          key={subject.id}
                          first={index === 0}
                          title={subject.name}
                          subtitle={
                            subject.gradeCount === 1
                              ? t("1 grade")
                              : t("{count} grades", {
                                  count: subject.gradeCount,
                                })
                          }
                          trailing={
                            <SharedAverageText
                              ratio={subject.average}
                              scale={friend.sharing?.year.scale ?? null}
                              decimals={friend.sharing?.year.decimals ?? null}
                            />
                          }
                        />
                      ))}
                    </Card>
                  </Section>
                ) : null}
              </>
            ) : (
              <Empty
                icon="eye-off-outline"
                title={t("Nothing is shared right now")}
                body={t(
                  "They locked their figures, or have no academic year to share yet.",
                )}
              />
            )}

            <Section title={t("Actions")}>
              <Card style={{ gap: space.sm }}>
                <Button
                  label={t("Remove friend")}
                  variant="secondary"
                  disabled={remove.isPending}
                  onPress={() =>
                    Alert.alert(
                      t("Remove this friend?"),
                      t(
                        "Neither of you will see the other's figures any more.",
                      ),
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("Remove friend"),
                          style: "destructive",
                          onPress: () =>
                            remove.mutate({
                              friendshipId: friendshipId ?? "",
                            }),
                        },
                      ],
                    )
                  }
                />
                <Button
                  label={t("Block")}
                  variant="destructive"
                  disabled={block.isPending}
                  onPress={() =>
                    Alert.alert(
                      t("Block this account?"),
                      t(
                        "The friendship ends immediately and they can no longer reach you. They are not notified.",
                      ),
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("Block"),
                          style: "destructive",
                          onPress: () =>
                            block.mutate({ userId: friend.userId }),
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
                      params: { targetUserId: friend.userId },
                    })
                  }
                />
              </Card>
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
