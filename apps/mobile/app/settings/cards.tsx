import { Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { metricLabel, useCards } from "@/components/use-cards";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

/**
 * The dashboard, as a list of choices.
 *
 * Reordering is up and down rather than drag-and-drop: a drag inside a
 * scrolling list is a fight on a phone, and there are rarely more than eight
 * cards. Hidden cards stay listed so turning one back on is one tap, not a
 * rebuild.
 */
export default function Cards() {
  const router = useRouter();
  const { yearId } = useYear();
  const { isLoading, specs, hidden } = useCards("overview");

  const reorder = useMutation({
    mutationFn: (input: Parameters<typeof client.cards.reorder>[0]) =>
      client.cards.reorder(input),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.cards.update>[0]) =>
      client.cards.update(input),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  const reset = useMutation({
    mutationFn: (input: Parameters<typeof client.cards.reset>[0]) =>
      client.cards.reset(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
    },
  });

  if (isLoading) return <Loading />;

  const move = (index: number, direction: -1 | 1) => {
    const next = [...specs];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    haptic("selection");
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    reorder.mutate({ cardIds: next.map((spec) => spec.id) });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Dashboard cards") }} />
      <Screen
        footer={
          <Button
            label={t("Add a card")}
            onPress={() => router.push("/settings/card-edit")}
          />
        }
      >
        {specs.length === 0 && hidden.length === 0 ? (
          <Section>
            <Empty
              icon="cube-outline"
              title={t("No cards")}
              body={t("Add one, or restore the ones the app starts with.")}
            />
          </Section>
        ) : null}

        {specs.map((spec, index) => (
          <Section key={spec.id}>
          <Card padded={false}>
              <Row
                title={spec.title ?? metricLabel(spec.metric)}
                subtitle={metricLabel(spec.metric)}
                onPress={() => router.push(`/settings/card-edit?id=${spec.id}`)}
              />
              <Row
                title={t("Move up")}
                onPress={() => move(index, -1)}
              />
              <Row
                title={t("Move down")}
                onPress={() => move(index, 1)}
              />
              <Row
                title={t("Hide")}
                onPress={() => {
                  haptic("light");
                  update.mutate({ cardId: spec.id, hidden: true });
                }}
              />
          </Card>
        </Section>
        ))}

        {hidden.length > 0 ? (
          <Section title={t("Hidden")}>
          <Card padded={false}>
              {hidden.map((spec) => (
                <Row
                  key={spec.id}
                  title={spec.title ?? metricLabel(spec.metric)}
                  onPress={() => {
                    haptic("light");
                    update.mutate({ cardId: spec.id, hidden: false });
                  }}
                />
              ))}
          </Card>
        </Section>
        ) : null}

        <Section>
          <Card padded={false}>
            <Row
              title={t("Restore the default cards")}
              onPress={() =>
                Alert.alert(
                  t("Restore the defaults?"),
                  t("Your current cards are replaced. Nothing else changes."),
                  [
                    { text: t("Cancel"), style: "cancel" },
                    {
                      text: t("Restore"),
                      onPress: () =>
                        yearId && reset.mutate({ yearId, surface: "overview" }),
                    },
                  ],
                )
              }
            />
            <Note>{t("Cards are per year, so a new year starts from the defaults.")}</Note>
          </Card>
        </Section>
      </Screen>
    </>
  );
}
