import { Alert } from "react-native";
import { Stack } from "expo-router";
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
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";

export default function BlockedAccounts() {
  const blocks = useQuery(orpc.social.blocks.list.queryOptions());
  const unblock = useMutation({
    ...orpc.social.blocks.remove.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.social.blocks.list.queryKey(),
      }),
  });

  return (
    <SocialRouteGate>
      <>
        <Stack.Screen options={{ title: t("Blocked accounts") }} />
        <Screen>
          <PrivacyBoundaryNotice compact />
          <Note>
            {t(
              "Blocking removes friendship, pending requests, circle membership and sharing in both directions. Unblocking never recreates them.",
            )}
          </Note>
          <Section title={t("Blocked by you")}>
            {blocks.isLoading ? (
              <Loading />
            ) : blocks.isError ? (
              <Problem>{t("Blocked accounts could not be refreshed.")}</Problem>
            ) : (blocks.data?.length ?? 0) === 0 ? (
              <Empty
                icon="shield-checkmark-outline"
                title={t("No blocked accounts")}
                body={t(
                  "You can block from a friend profile or an incoming request.",
                )}
              />
            ) : (
              (blocks.data ?? []).map((block) => (
                <Card key={block.id} style={{ gap: space.md }}>
                  <SocialIdentity
                    displayName={block.displayName ?? t("Unavailable profile")}
                    handle={block.handle}
                  />
                  <Button
                    label={t("Unblock")}
                    variant="ghost"
                    disabled={unblock.isPending}
                    onPress={() =>
                      Alert.alert(
                        t("Unblock this account?"),
                        t(
                          "No friendship or sharing permission will be restored automatically.",
                        ),
                        [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("Unblock"),
                            onPress: () =>
                              unblock.mutate({ blockId: block.id }),
                          },
                        ],
                      )
                    }
                  />
                </Card>
              ))
            )}
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
