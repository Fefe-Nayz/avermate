import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TextField } from "@/components/field";
import { SocialRouteGate } from "@/components/social/social-gate";
import { PrivacyBoundaryNotice } from "@/components/social/social-ui";
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
import { orpc, queryClient } from "@/lib/orpc";

export default function FriendCircles() {
  const router = useRouter();
  const circles = useQuery(orpc.social.circles.list.queryOptions());
  const [name, setName] = useState("");
  const create = useMutation({
    ...orpc.social.circles.create.mutationOptions(),
    onSuccess: async (created) => {
      setName("");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.circles.list.queryKey(),
      });
      if (created?.id) router.push(`/social/circles/${created.id}`);
    },
  });

  return (
    <SocialRouteGate>
      <>
        <Stack.Screen options={{ title: t("Friend circles") }} />
        <Screen>
          <PrivacyBoundaryNotice compact />
          <Section title={t("New circle")}>
            <TextField
              label={t("Circle name")}
              value={name}
              onChangeText={setName}
              placeholder={t("Close friends")}
              maxLength={60}
            />
            <Button
              label={t("Create circle")}
              disabled={!name.trim() || create.isPending}
              loading={create.isPending}
              onPress={() => create.mutate({ name: name.trim() })}
            />
            {create.isError ? (
              <Problem>{t("The circle could not be created.")}</Problem>
            ) : null}
          </Section>

          <Section title={t("Your circles")}>
            {circles.isLoading ? (
              <Loading />
            ) : circles.isError ? (
              <Empty
                icon="cloud-offline-outline"
                title={t("Circles could not be refreshed")}
                body={t("Reconnect before changing profile permissions.")}
              />
            ) : (circles.data?.length ?? 0) === 0 ? (
              <Empty
                icon="people-circle-outline"
                title={t("No circles yet")}
                body={t(
                  "A circle groups accepted friends for more precise field permissions.",
                )}
              />
            ) : (
              <Card padded={false}>
                {(circles.data ?? []).map((circle, index) => (
                  <Row
                    key={circle.id}
                    first={index === 0}
                    title={circle.name}
                    subtitle={t("{count} members", {
                      count: circle.members.length,
                    })}
                    onPress={() => router.push(`/social/circles/${circle.id}`)}
                  />
                ))}
              </Card>
            )}
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
