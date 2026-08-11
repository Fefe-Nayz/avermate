import { Alert, Text } from "react-native";
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
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { type, usePalette } from "@/lib/theme";

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
  const palette = usePalette();
  const { yearId } = useYear();
  const { isLoading, specs, hidden } = useCards("overview");
  const listKey = orpc.cards.list.queryKey({
    input: { yearId: yearId ?? "", surface: "overview" },
  });

  const refresh = () =>
    yearId
      ? queryClient.invalidateQueries({ queryKey: listKey })
      : Promise.resolve();

  const reorder = useMutation({
    mutationFn: (input: Parameters<typeof client.cards.reorder>[0]) =>
      client.cards.reorder(input),
    onSuccess: () => void refresh(),
  });

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.cards.update>[0]) =>
      client.cards.update(input),
    onSuccess: () => void refresh(),
  });

  const reset = useMutation({
    mutationFn: (input: Parameters<typeof client.cards.reset>[0]) =>
      client.cards.reset(input),
    onSuccess: () => {
      haptic("success");
      void refresh();
    },
  });

  const duplicate = useMutation({
    mutationFn: (spec: (typeof specs)[number]) => {
      if (!yearId) throw new Error("No year selected");
      return client.cards.create({
        yearId,
        surface: "overview",
        metric: spec.metric,
        targetKind: spec.target.kind,
        targetId: spec.target.referenceId,
        goalId: spec.goalId,
        display: spec.display,
        span: spec.span,
        title: spec.title ? `${spec.title} · ${t("Copy")}`.slice(0, 48) : null,
        accent: spec.accent,
        hidden: false,
      });
    },
    onSuccess: () => {
      haptic("success");
      void refresh();
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
            label={t("Browse widget library")}
            onPress={() => router.push("/settings/widget-library")}
          />
        }
      >
        <Section>
          <Card>
            <Text selectable style={[type.heading, { color: palette.text }]}>
              {t("{visible} visible · {hidden} hidden", {
                visible: specs.length,
                hidden: hidden.length,
              })}
            </Text>
            <Text selectable style={[type.footnote, { color: palette.textMuted }]}>
              {t("Build this year’s dashboard from 21 reusable analytics widgets.")}
            </Text>
          </Card>
        </Section>
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
              <Row
                title={t("Duplicate")}
                onPress={() => duplicate.mutate(spec)}
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
