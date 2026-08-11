import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TextField } from "@/components/field";
import { SocialRouteGate } from "@/components/social/social-gate";
import { SocialIdentity } from "@/components/social/social-ui";
import {
  Button,
  Card,
  Empty,
  Loading,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { client, orpc, queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";

export default function FriendCircleDetails() {
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const router = useRouter();
  const circles = useQuery(orpc.social.circles.list.queryOptions());
  const friends = useQuery(orpc.social.friends.list.queryOptions());
  const circle = circles.data?.find((item) => item.id === circleId);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (circle) setName(circle.name);
  }, [circle?.id, circle?.revision]);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.social.circles.list.queryKey(),
    });
  const rename = useMutation({
    ...orpc.social.circles.update.mutationOptions(),
    onSuccess: refresh,
    onError: () =>
      setProblem(t("The circle changed elsewhere. It has been refreshed.")),
  });
  const removeCircle = useMutation({
    ...orpc.social.circles.delete.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      router.replace("/social/circles");
    },
  });
  const add = useMutation({
    mutationFn: (friendshipId: string) => {
      if (!circle) throw new Error("Circle unavailable");
      return client.social.circles.addMember({
        circleId: circle.id,
        friendshipId,
        expectedRevision: circle.revision,
      });
    },
    onSuccess: refresh,
    onError: () =>
      setProblem(t("Membership changed elsewhere. Refresh and try again.")),
  });
  const remove = useMutation({
    mutationFn: (circleMemberId: string) => {
      if (!circle) throw new Error("Circle unavailable");
      return client.social.circles.removeMember({
        circleId: circle.id,
        circleMemberId,
        expectedRevision: circle.revision,
      });
    },
    onSuccess: refresh,
    onError: () =>
      setProblem(t("Membership changed elsewhere. Refresh and try again.")),
  });

  const existing = useMemo(
    () =>
      new Set(
        circle?.members.map((member) => member.friendshipId).filter(Boolean),
      ),
    [circle?.members],
  );
  const availableFriends = friends.data?.friends.filter(
    (friend) => !existing.has(friend.friendshipId),
  );

  if (circles.isLoading || friends.isLoading) return <Loading />;

  return (
    <SocialRouteGate>
      <>
        <Stack.Screen options={{ title: circle?.name ?? t("Friend circle") }} />
        <Screen>
          {!circle || circles.isError || friends.isError ? (
            <Empty
              icon="cloud-offline-outline"
              title={t("This circle could not be loaded")}
              body={t(
                "It may have been deleted or changed in another session.",
              )}
            />
          ) : (
            <>
              <Section title={t("Circle name")}>
                <TextField
                  label={t("Name")}
                  value={name}
                  onChangeText={setName}
                  maxLength={60}
                />
                <Button
                  label={t("Save name")}
                  variant="secondary"
                  disabled={
                    !name.trim() ||
                    name.trim() === circle.name ||
                    rename.isPending
                  }
                  loading={rename.isPending}
                  onPress={() =>
                    rename.mutate({
                      circleId: circle.id,
                      name: name.trim(),
                      expectedRevision: circle.revision,
                    })
                  }
                />
              </Section>

              <Section title={t("Members")}>
                {circle.members.length === 0 ? (
                  <Empty
                    icon="person-add-outline"
                    title={t("No members in this circle")}
                    body={t("Only accepted friends can be added.")}
                  />
                ) : (
                  circle.members.map((member) => (
                    <Card key={member.id} style={{ gap: space.md }}>
                      <SocialIdentity
                        displayName={
                          member.profile?.displayName ?? t("Private friend")
                        }
                        avatar={member.profile?.avatar}
                      />
                      <Button
                        label={t("Remove from circle")}
                        variant="ghost"
                        disabled={remove.isPending}
                        onPress={() => remove.mutate(member.id)}
                      />
                    </Card>
                  ))
                )}
              </Section>

              <Section title={t("Circle privacy")}>
                <Button
                  label={t("Choose fields shared with this circle")}
                  variant="secondary"
                  onPress={() =>
                    router.push({
                      pathname: "/social/grants",
                      params: {
                        audience: "circle",
                        audienceId: circle.id,
                        label: circle.name,
                      },
                    })
                  }
                />
              </Section>

              {availableFriends && availableFriends.length > 0 ? (
                <Section title={t("Add accepted friends")}>
                  <Card padded={false}>
                    {availableFriends.map((friend, index) => (
                      <Row
                        key={friend.friendshipId}
                        first={index === 0}
                        title={
                          friend.profile?.displayName ?? t("Private friend")
                        }
                        subtitle={t("Add to {circle}", { circle: circle.name })}
                        onPress={() => add.mutate(friend.friendshipId)}
                      />
                    ))}
                  </Card>
                </Section>
              ) : null}

              {problem ? <Problem>{problem}</Problem> : null}

              <Section title={t("Delete circle")}>
                <Button
                  label={t("Delete circle")}
                  variant="destructive"
                  loading={removeCircle.isPending}
                  onPress={() =>
                    Alert.alert(
                      t("Delete this circle?"),
                      t(
                        "Circle-specific sharing stops. Friendships are not removed.",
                      ),
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("Delete"),
                          style: "destructive",
                          onPress: () =>
                            removeCircle.mutate({
                              circleId: circle.id,
                              expectedRevision: circle.revision,
                            }),
                        },
                      ],
                    )
                  }
                />
              </Section>
            </>
          )}
        </Screen>
      </>
    </SocialRouteGate>
  );
}
