import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SocialIdentity } from "@/components/social/social-ui";
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
import { space } from "@/lib/theme";

/** Someone handed over a link: who is asking, then one button. */
export default function FriendInvitation() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const preview = useQuery({
    ...orpc.social.friends.invitations.preview.queryOptions({
      input: { token: token ?? "" },
    }),
    enabled: Boolean(token),
    retry: false,
  });
  const accept = useMutation({
    ...orpc.social.friends.invitations.accept.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.queryKey(),
      });
      if (result.friendshipId) {
        router.replace(`/social/friend/${result.friendshipId}`);
      } else {
        router.replace("/social");
      }
    },
  });

  const data = preview.data;

  return (
    <>
      <Stack.Screen options={{ title: t("Friend invitation") }} />
      <Screen>
        {preview.isLoading ? (
          <Loading />
        ) : !data ? (
          <Empty
            icon="link-outline"
            title={t("This invitation is no longer valid")}
            body={t("It may have expired, been revoked, or already used.")}
            action={
              <Button
                label={t("Go to friends")}
                variant="secondary"
                onPress={() => router.replace("/social")}
              />
            }
          />
        ) : (
          <Section title={t("Friend invitation")}>
            <Card style={{ gap: space.lg }}>
              <SocialIdentity
                name={data.inviter.name}
                handle={data.inviter.handle}
                avatar={data.inviter.avatar}
              />
              <Note>
                {t("Becoming friends shares only what each of you unlocked.")}
              </Note>
              {data.self ? (
                <Note>
                  {t(
                    "This is your own invitation link — send it to someone else.",
                  )}
                </Note>
              ) : data.alreadyFriends ? (
                <Button
                  label={t("You are already friends.")}
                  variant="secondary"
                  onPress={() => router.replace("/social")}
                />
              ) : (
                <Button
                  label={t("Accept and become friends")}
                  loading={accept.isPending}
                  onPress={() => accept.mutate({ token: token ?? "" })}
                />
              )}
            </Card>
          </Section>
        )}
      </Screen>
    </>
  );
}
