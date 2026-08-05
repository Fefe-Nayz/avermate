import { Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Spacer } from "@expo/ui";
import {
  Button,
  Empty,
  Grouped,
  Line,
  Loading,
  Section,
  Text,
} from "@/components/native";
import { metricLabel, useCards } from "@/components/use-cards";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

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
      <Grouped
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
              glyph="card"
              title={t("No cards")}
              body={t("Add one, or restore the ones the app starts with.")}
            />
          </Section>
        ) : null}

        {specs.map((spec, index) => (
          <Section key={spec.id}>
            <Line
              leading="card"
              title={spec.title ?? metricLabel(spec.metric)}
              detail={metricLabel(spec.metric)}
              onPress={() => router.push(`/settings/card-edit?id=${spec.id}`)}
            />
            <Line
              leading="chevronUp"
              title={t("Move up")}
              onPress={() => move(index, -1)}
            />
            <Line
              leading="chevronDown"
              title={t("Move down")}
              onPress={() => move(index, 1)}
            />
            <Line
              leading="close"
              title={t("Hide")}
              onPress={() => {
                haptic("light");
                update.mutate({ cardId: spec.id, hidden: true });
              }}
            />
          </Section>
        ))}

        {hidden.length > 0 ? (
          <Section title={t("Hidden")}>
            {hidden.map((spec) => (
              <Line
                key={spec.id}
                leading="visibility"
                title={spec.title ?? metricLabel(spec.metric)}
                onPress={() => {
                  haptic("light");
                  update.mutate({ cardId: spec.id, hidden: false });
                }}
              />
            ))}
          </Section>
        ) : null}

        <Section>
          <Line
            leading="reset"
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
          <Text size="footnote" tone="muted">
            {t("Cards are per year, so a new year starts from the defaults.")}
          </Text>
        </Section>

        <Spacer size={space.xl} />
      </Grouped>
    </>
  );
}
