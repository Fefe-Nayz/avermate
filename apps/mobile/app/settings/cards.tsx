import { Alert, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { WIDGET_DEFINITION_VERSION, type WidgetSurface } from "@avermate/core";
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
import { useCards } from "@/components/use-cards";
import { useYear } from "@/components/year-provider";
import { widgetCardTitle } from "@/components/widgets/widget-renderer";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { type, usePalette } from "@/lib/theme";

function widgetSurface(value: string | undefined): WidgetSurface {
  return value === "subject" || value === "grade" || value === "insights"
    ? value
    : "overview";
}

export default function Cards() {
  const router = useRouter();
  const palette = usePalette();
  const params = useLocalSearchParams<{ surface?: string }>();
  const surface = widgetSurface(params.surface);
  const { yearId } = useYear();
  const widgets = useCards(surface);
  const listKey = orpc.cards.list.queryKey({
    input: { yearId: yearId ?? "", surface },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: listKey });
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
    mutationFn: () => {
      if (!yearId) throw new Error("No year selected");
      return client.cards.reset({ yearId, surface });
    },
    onSuccess: () => {
      haptic("success");
      void refresh();
    },
  });
  const duplicate = useMutation({
    mutationFn: (card: (typeof widgets.cards)[number]) => {
      if (!yearId) throw new Error("No year selected");
      return client.cards.create({
        yearId,
        surface,
        definitionVersion: WIDGET_DEFINITION_VERSION,
        definitionJson: card.definition,
        span: card.span,
        title: card.title ? `${card.title} · ${t("Copy")}`.slice(0, 48) : null,
        accent: card.accent,
        hidden: false,
      });
    },
    onSuccess: () => {
      haptic("success");
      void refresh();
    },
  });

  if (widgets.isLoading) return <Loading />;
  const move = (index: number, direction: -1 | 1) => {
    const next = [...widgets.cards];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    haptic("selection");
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    reorder.mutate({ cardIds: next.map((card) => card.id) });
  };
  const route = (id?: string) =>
    `/settings/card-edit?surface=${surface}${id ? `&id=${encodeURIComponent(id)}` : ""}` as const;

  return (
    <>
      <Stack.Screen
        options={{
          title:
            surface === "insights"
              ? t("Insights widgets")
              : t("Dashboard widgets"),
        }}
      />
      <Screen
        footer={
          <Button
            label={t("Create widget")}
            icon="add-circle"
            onPress={() => router.push(route())}
          />
        }
      >
        <Section>
          <Card padded={false}>
            <Row
              first
              title={t("Browse the gallery")}
              subtitle={t("Curated cards you can install in one tap")}
              onPress={() =>
                router.push(`/settings/card-gallery?surface=${surface}`)
              }
            />
          </Card>
        </Section>
        <Section>
          <Card>
            <Text selectable style={[type.heading, { color: palette.text }]}>
              {t("{visible} visible · {hidden} hidden", {
                visible: widgets.cards.length,
                hidden: widgets.hidden.length,
              })}
            </Text>
            <Text
              selectable
              style={[type.footnote, { color: palette.textMuted }]}
            >
              {t("Each widget keeps its definition, chart and width together.")}
            </Text>
          </Card>
        </Section>

        {widgets.all.length === 0 ? (
          <Section>
            <Empty
              icon="analytics-outline"
              title={t("No widgets")}
              body={t("Create one or restore the recommended layout.")}
            />
          </Section>
        ) : null}

        {widgets.cards.map((card, index) => (
          <Section key={card.id}>
            <Card padded={false}>
              <Row
                title={widgetCardTitle(card)}
                subtitle={t("Span {count} of 4", { count: card.span })}
                onPress={() => router.push(route(card.id))}
              />
              <Row title={t("Move up")} onPress={() => move(index, -1)} />
              <Row title={t("Move down")} onPress={() => move(index, 1)} />
              <Row
                title={t("Hide")}
                onPress={() => update.mutate({ cardId: card.id, hidden: true })}
              />
              <Row
                title={t("Duplicate")}
                onPress={() => duplicate.mutate(card)}
              />
            </Card>
          </Section>
        ))}

        {widgets.hidden.length > 0 ? (
          <Section title={t("Hidden")}>
            <Card padded={false}>
              {widgets.hidden.map((card) => (
                <Row
                  key={card.id}
                  title={widgetCardTitle(card)}
                  onPress={() =>
                    update.mutate({ cardId: card.id, hidden: false })
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        <Section>
          <Card padded={false}>
            <Row
              title={t("Restore the recommended layout")}
              onPress={() =>
                Alert.alert(
                  t("Restore the recommended layout?"),
                  t("Your current widgets are replaced. Nothing else changes."),
                  [
                    { text: t("Cancel"), style: "cancel" },
                    {
                      text: t("Restore"),
                      onPress: () => reset.mutate(),
                    },
                  ],
                )
              }
            />
            <Note>
              {t("Layouts are stored separately for each year and surface.")}
            </Note>
          </Card>
        </Section>
      </Screen>
    </>
  );
}
