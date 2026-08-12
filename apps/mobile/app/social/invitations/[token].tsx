import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { groupKindLabel } from "@/components/social/social-ui";
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

/** A group link: what the room is, who invited, one button. */
export default function GroupInvitation() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const preview = useQuery({
    ...orpc.social.groups.invitations.preview.queryOptions({
      input: { token: token ?? "" },
    }),
    enabled: Boolean(token),
    retry: false,
  });
  const accept = useMutation({
    ...orpc.social.groups.invitations.accept.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.replace(`/social/groups/${result.groupId}`);
    },
  });

  const data = preview.data;

  return (
    <>
      <Stack.Screen options={{ title: t("Group invitation") }} />
      <Screen>
        {preview.isLoading ? (
          <Loading />
        ) : !data ? (
          <Empty
            icon="link-outline"
            title={t("This invitation is no longer valid")}
            body={t(
              "It may have expired, been revoked, or the group is gone.",
            )}
            action={
              <Button
                label={t("Go to groups")}
                variant="secondary"
                onPress={() => router.replace("/social/groups")}
              />
            }
          />
        ) : (
          <Section title={data.group.name}>
            <Card style={{ gap: space.lg }}>
              {data.group.description ? (
                <Note>{data.group.description}</Note>
              ) : null}
              <Note>
                {groupKindLabel(data.group.kind) +
                  " · " +
                  (data.group.comparedSubjectName
                    ? t("Compares {name}", {
                        name: data.group.comparedSubjectName,
                      })
                    : t("Compares general averages"))}
              </Note>
              <Note>
                {data.inviter
                  ? t("{name} invites you. {count} people are in.", {
                      name: data.inviter.name,
                      count: data.group.memberCount,
                    })
                  : t("{count} people are in.", {
                      count: data.group.memberCount,
                    })}
              </Note>
              <Note>
                {t(
                  "Members compare general averages. Yours is visible on joining, and one switch inside the group hides it whenever you want.",
                )}
              </Note>
              {data.alreadyMember ? (
                <Button
                  label={t("You are already a member.")}
                  variant="secondary"
                  onPress={() => router.replace("/social/groups")}
                />
              ) : (
                <Button
                  label={t("Join the group")}
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
