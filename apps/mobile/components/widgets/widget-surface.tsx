import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  layoutCards,
  widgetDefinitionToLegacyProjection,
  type CardResult,
  type CardSpec,
  type WidgetEvaluationResult,
  type WidgetSurface,
} from "@avermate/core";
import { Button, Card, Empty, Loading, Problem } from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { t } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";
import { WidgetCardView, widgetCardTitle } from "./widget-renderer";
import { useCards, type WidgetCardModel } from "@/components/use-cards";
import { CardResultBody } from "@/components/card-view";

function layoutSpec(card: WidgetCardModel): CardSpec {
  if (card.legacySpec) return card.legacySpec;
  const projection = widgetDefinitionToLegacyProjection(card.definition);
  return {
    id: card.id,
    metric: projection.metric,
    target: { kind: projection.targetKind, referenceId: projection.targetId },
    display: projection.display,
    span: card.span,
    title: card.title,
    accent: card.accent,
    goalId: projection.goalId,
    sortOrder: card.sortOrder,
    hidden: card.hidden,
  };
}

export function WidgetGrid({
  cards,
  results,
}: {
  cards: WidgetCardModel[];
  results: Map<string, WidgetEvaluationResult | CardResult>;
}) {
  const [width, setWidth] = useState(0);
  const columns = width >= 720 ? 4 : width >= 500 ? 3 : width >= 300 ? 2 : 1;
  const placed = useMemo(() => {
    const byId = new Map(cards.map((card) => [card.id, card]));
    return layoutCards(cards.map(layoutSpec), columns).flatMap((entry) => {
      const card = byId.get(entry.spec.id);
      return card ? [{ card, columns: entry.columns }] : [];
    });
  }, [cards, columns]);
  const gap = space.sm;
  const available = Math.max(0, width - gap * (columns - 1));

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: "row", flexWrap: "wrap", gap }}
    >
      {placed.map((entry) => (
        <View
          key={entry.card.id}
          style={{
            width:
              width === 0
                ? "100%"
                : (available * entry.columns) / columns +
                  gap * (entry.columns - 1),
            minWidth: 0,
          }}
        >
          {entry.card.legacySpec ? (
            <LegacyWidgetCard
              card={entry.card}
              result={results.get(entry.card.id) as CardResult | undefined}
            />
          ) : (
            <WidgetCardView
              card={entry.card}
              result={
                results.get(entry.card.id) as WidgetEvaluationResult | undefined
              }
            />
          )}
        </View>
      ))}
    </View>
  );
}

function LegacyWidgetCard({
  card,
  result,
}: {
  card: WidgetCardModel;
  result: CardResult | undefined;
}) {
  const palette = usePalette();
  const spec = card.legacySpec;
  if (!spec || !result || result.kind === "empty") {
    return <WidgetCardView card={card} result={undefined} />;
  }
  const listy = result.kind === "list";
  const accent =
    card.accent && /^#[0-9a-f]{6}$/i.test(card.accent) ? card.accent : null;
  return (
    <Card
      padded={!listy}
      style={accent ? { borderTopWidth: 3, borderTopColor: accent } : undefined}
    >
      <View style={{ gap: space.md }}>
        <Text
          numberOfLines={2}
          style={[
            type.callout,
            {
              color: palette.text,
              fontWeight: "600",
              paddingHorizontal: listy ? space.lg : 0,
              paddingTop: listy ? space.lg : 0,
            },
          ]}
        >
          {widgetCardTitle(card)}
        </Text>
        <CardResultBody spec={spec} result={result} />
      </View>
    </Card>
  );
}

export function WidgetSurfaceContent({ surface }: { surface: WidgetSurface }) {
  const router = useRouter();
  const { yearId } = useYear();
  const widgets = useCards(surface);
  const listKey = orpc.cards.list.queryKey({
    input: { yearId: yearId ?? "", surface },
  });
  const reset = useMutation({
    mutationFn: () => {
      if (!yearId) throw new Error("No year selected");
      return client.cards.reset({ yearId, surface });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: listKey }),
  });

  if (widgets.isLoading) return <Loading />;
  if (widgets.error) {
    return <Problem>{t("Widgets could not be refreshed.")}</Problem>;
  }
  if (widgets.cards.length === 0 && widgets.all.length > 0) {
    return (
      <Empty
        icon="options-outline"
        title={t("All widgets are hidden")}
        body={t("Open customization to show one again.")}
        action={
          <Button
            label={t("Customize")}
            variant="outline"
            onPress={() => router.push(`/settings/cards?surface=${surface}`)}
          />
        }
      />
    );
  }
  if (widgets.cards.length === 0) {
    return (
      <Empty
        icon="analytics-outline"
        title={
          surface === "insights"
            ? t("Build your Insights")
            : t("No dashboard widgets")
        }
        body={
          surface === "insights"
            ? t(
                "Start with the recommended analysis layout or create a widget from scratch.",
              )
            : t(
                "Restore the recommended dashboard or add only the measures you need.",
              )
        }
        action={
          <View style={{ width: "100%", gap: space.sm }}>
            <Button
              label={t("Use recommended layout")}
              icon="sparkles-outline"
              loading={reset.isPending}
              onPress={() => reset.mutate()}
            />
            <Button
              label={t("Create widget")}
              icon="add-circle"
              variant="outline"
              onPress={() =>
                router.push(`/settings/card-edit?surface=${surface}`)
              }
            />
          </View>
        }
      />
    );
  }
  return <WidgetGrid cards={widgets.cards} results={widgets.results} />;
}
