import { useMemo, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { CARD_METRICS, type CardMetric } from "@avermate/core";
import { TextField } from "@/components/field";
import { metricHint, metricLabel } from "@/components/use-cards";
import {
  WIDGET_CATALOG,
  type WidgetCategory,
} from "@/components/widget-catalog";
import { Card, Empty, Note, Row, Screen, Section } from "@/components/ui";
import { t } from "@/lib/i18n";

const CATEGORIES: readonly WidgetCategory[] = [
  "essentials",
  "momentum",
  "results",
  "consistency",
  "goals",
];

function categoryLabel(category: WidgetCategory): string {
  switch (category) {
    case "essentials":
      return t("Essentials");
    case "momentum":
      return t("Momentum and progress");
    case "results":
      return t("Results and rankings");
    case "consistency":
      return t("Consistency and habits");
    case "goals":
      return t("Goals");
  }
}

function displayLabel(display: string): string {
  switch (display) {
    case "sparkline":
      return t("Number and a line");
    case "chart":
      return t("A chart");
    case "list":
      return t("A list");
    case "gauge":
      return t("A bar");
    default:
      return t("Just the number");
  }
}

export default function WidgetLibrary() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return WIDGET_CATALOG;
    return WIDGET_CATALOG.filter((entry) => {
      const haystack = `${metricLabel(entry.metric)} ${metricHint(entry.metric) ?? ""}`;
      return haystack.toLocaleLowerCase().includes(needle);
    });
  }, [search]);

  const add = (metric: CardMetric) => {
    router.push(`/settings/card-edit?metric=${encodeURIComponent(metric)}`);
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Widget library") }} />
      <Screen>
        <Section>
          <TextField
            label={t("Search metrics")}
            value={search}
            onChangeText={setSearch}
            placeholder={t("Average, trend, streak…")}
          />
          <Note>
            {t("Choose what matters; scope, appearance and width come next.")}
          </Note>
        </Section>

        {visible.length === 0 ? (
          <Section>
            <Empty
              icon="search-outline"
              title={t("Nothing matches.")}
              body={t("Try a different metric name.")}
            />
          </Section>
        ) : null}

        {CATEGORIES.map((category) => {
          const entries = visible.filter((entry) => entry.category === category);
          if (entries.length === 0) return null;
          return (
            <Section key={category} title={categoryLabel(category)}>
              <Card padded={false}>
                {entries.map((entry, index) => (
                  <Row
                    key={entry.metric}
                    first={index === 0}
                    title={metricLabel(entry.metric)}
                    subtitle={
                      metricHint(entry.metric) ??
                      displayLabel(entry.recommendedDisplay)
                    }
                    onPress={() => add(entry.metric)}
                  />
                ))}
              </Card>
            </Section>
          );
        })}

        <Section>
          <Note>
            {t("All {count} widgets use the same audited analytics engine as the web app.", {
              count: CARD_METRICS.length,
            })}
          </Note>
        </Section>
      </Screen>
    </>
  );
}
