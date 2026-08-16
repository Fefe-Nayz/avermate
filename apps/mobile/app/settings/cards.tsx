import { useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WIDGET_DEFINITION_VERSION, type WidgetSurface } from "@avermate/core";
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
import {
  SortableHandle,
  SortableList,
  useSortableScroll,
} from "@/components/sortable-list";
import { useCards, type WidgetCardModel } from "@/components/use-cards";
import { useYear } from "@/components/year-provider";
import { widgetCardTitle } from "@/components/widgets/widget-renderer";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { useInteractionPreferences } from "@/lib/interaction-preferences";
import { space, type, usePalette } from "@/lib/theme";

function widgetSurface(value: string | undefined): WidgetSurface {
  return value === "subject" || value === "grade" || value === "insights"
    ? value
    : "overview";
}

/**
 * The widgets management list.
 *
 * Order is arranged the way the web grid arranges it: every widget carries a
 * grip, dragging hands the complete visible order to the same `cards.reorder`
 * mutation, and hidden widgets follow after it unchanged. The screen brings
 * its own scroll view so a drag near an edge can drive the scrolling.
 */
export default function Cards() {
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { compactMode } = useInteractionPreferences();
  const params = useLocalSearchParams<{ surface?: string }>();
  const surface = widgetSurface(params.surface);
  const { yearId } = useYear();
  const widgets = useCards(surface);
  const scroll = useSortableScroll();
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listKey = orpc.cards.list.queryKey({
    input: { yearId: yearId ?? "", surface },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: listKey });

  // A fresh list is authoritative: the optimistic order has either been
  // written and comes back identical, or it failed and this discards it.
  useEffect(() => setOrderedIds(null), [widgets.all]);

  const reorder = useMutation({
    mutationFn: (input: Parameters<typeof client.cards.reorder>[0]) =>
      client.cards.reorder(input),
    onSuccess: () => {
      haptic("success");
      void refresh();
    },
    onError: () => {
      haptic("error");
      setOrderedIds(null);
      setError(t("The widgets could not be reordered."));
    },
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

  const displayed = useMemo(() => {
    const visible = widgets.all.filter((card) => !card.hidden);
    if (!orderedIds) return visible;
    const byId = new Map(visible.map((card) => [card.id, card]));
    const known = new Set(orderedIds);
    return [
      ...orderedIds
        .map((id) => byId.get(id))
        .filter((card): card is WidgetCardModel => Boolean(card)),
      ...visible.filter((card) => !known.has(card.id)),
    ];
  }, [widgets.all, orderedIds]);

  if (widgets.isLoading) return <Loading />;

  // The web's drag-end contract: the whole visible order, in one payload.
  const reorderCards = (cardIds: string[]) => {
    if (reorder.isPending) return;
    setError(null);
    setOrderedIds(cardIds);
    reorder.mutate({ cardIds });
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
        scroll={false}
        footer={
          <Button
            label={t("Create widget")}
            icon="add-circle"
            onPress={() => router.push(route())}
          />
        }
      >
        <Animated.ScrollView
          ref={scroll.ref}
          onContentSizeChange={scroll.onContentSizeChange}
          scrollEnabled={!dragging}
          contentInsetAdjustmentBehavior="automatic"
          style={{ flex: 1 }}
          contentContainerStyle={{
            gap: compactMode ? space.md : space.lg,
            paddingBottom: insets.bottom + space.xxxl * 2,
          }}
          showsVerticalScrollIndicator={false}
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
                {t(
                  "Each widget keeps its definition, chart and width together.",
                )}
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

          {displayed.length > 0 ? (
            <Section>
              <SortableList
                ids={displayed.map((card) => card.id)}
                gap={compactMode ? space.md : space.lg}
                disabled={reorder.isPending}
                scroll={scroll}
                onDragStateChange={setDragging}
                onReorder={reorderCards}
                renderItem={(_id, index) => {
                  const card = displayed[index];
                  if (!card) return null;
                  return (
                    <Card padded={false}>
                      <View
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        <SortableHandle style={{ marginLeft: space.xs }} />
                        <View style={{ flex: 1 }}>
                          <Row
                            first
                            title={widgetCardTitle(card)}
                            subtitle={t("Span {count} of 4", {
                              count: card.span,
                            })}
                            onPress={() => router.push(route(card.id))}
                          />
                        </View>
                      </View>
                      <Row
                        title={t("Hide")}
                        onPress={() =>
                          update.mutate({ cardId: card.id, hidden: true })
                        }
                      />
                      <Row
                        title={t("Duplicate")}
                        onPress={() => duplicate.mutate(card)}
                      />
                    </Card>
                  );
                }}
              />
              {error ? <Problem>{error}</Problem> : null}
            </Section>
          ) : null}

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
                    t(
                      "Your current widgets are replaced. Nothing else changes.",
                    ),
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
        </Animated.ScrollView>
      </Screen>
    </>
  );
}
