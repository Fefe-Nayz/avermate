import { Text, View } from "react-native";
import type { CardResult, CardSpec } from "@avermate/core";
import { Card, Label, ProgressBar, Row, Section } from "@/components/ui";
import { AverageValue, DeltaValue, PercentValue } from "@/components/value";
import { Distribution, Sparkline } from "@/components/sparkline";
import { StatusPill } from "@/components/goal-status";
import { metricLabel } from "@/components/use-cards";
import { formatDay } from "@/components/format";
import { t } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";

/**
 * One card, drawn from its result.
 *
 * The switch is over the *result* shape rather than the metric, which is why
 * twenty-one metrics need nine branches: a pass rate and a consistency score
 * are both a percentage, so both look like one. Adding a metric that returns
 * an existing shape costs nothing here.
 */
export function CardView({
  spec,
  result,
  onPress,
}: {
  spec: CardSpec;
  result: CardResult | undefined;
  onPress?: () => void;
}) {
  const palette = usePalette();
  const title = spec.title ?? metricLabel(spec.metric);

  if (!result || result.kind === "empty") {
    return (
      <Section title={title}>
        <Card>
          <Text style={[type.footnote, { color: palette.textFaint }]}>
            {t("Nothing to show yet")}
          </Text>
        </Card>
      </Section>
    );
  }

  const listy = result.kind === "list";

  return (
    <Section title={title}>
      <Card padded={!listy}>
        <Body spec={spec} result={result} onPress={onPress} />
      </Card>
    </Section>
  );
}

function Body({
  spec,
  result,
  onPress,
}: {
  spec: CardSpec;
  result: CardResult;
  onPress?: () => void;
}) {
  const palette = usePalette();

  switch (result.kind) {
    case "ratio":
      return (
        <View style={{ gap: space.sm }}>
          <View
            style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}
          >
            <AverageValue ratio={result.ratio} size="display" showScale colored />
            <View style={{ paddingBottom: 4 }}>
              <DeltaValue delta={result.delta} size="callout" />
            </View>
          </View>
          {result.series && result.series.length > 2 ? (
            <Sparkline
              series={result.series}
              positive={(result.delta ?? 0) >= 0}
            />
          ) : null}
        </View>
      );

    case "count":
      return (
        <View style={{ gap: space.sm }}>
          <Text style={[type.display, { color: palette.text }]}>
            {String(result.count)}
          </Text>
          {result.series && result.series.length > 2 ? (
            <Sparkline series={result.series} />
          ) : null}
        </View>
      );

    case "percent":
      return (
        <View style={{ gap: space.sm }}>
          <PercentValue ratio={result.ratio} size="display" />
          {spec.display === "gauge" ? (
            <ProgressBar value={result.ratio ?? 0} />
          ) : null}
        </View>
      );

    case "scalar":
      return (
        <Text style={[type.display, { color: palette.text }]}>
          {result.value === null
            ? "—"
            : result.unit === "days"
              ? t("{count} days", { count: Math.round(result.value) })
              : result.unit === "count"
                ? String(Math.round(result.value))
                : result.value.toFixed(2)}
        </Text>
      );

    case "subject":
      return (
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <Text
            numberOfLines={1}
            style={[type.heading, { flex: 1, color: palette.text }]}
          >
            {result.name}
          </Text>
          <DeltaValue delta={result.delta} />
          <AverageValue ratio={result.ratio} size="heading" colored />
        </View>
      );

    case "grade":
      return (
        <View style={{ gap: space.xs }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <Text
              numberOfLines={1}
              style={[type.heading, { flex: 1, color: palette.text }]}
            >
              {result.name}
            </Text>
            <AverageValue ratio={result.ratio} size="heading" colored />
          </View>
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {`${result.subjectName} · ${formatDay(result.at)}`}
          </Text>
        </View>
      );

    case "list":
      return (
        <>
          {result.items.map((item, index) => (
            <Row
              key={item.id}
              first={index === 0}
              title={item.label}
              onPress={onPress}
              trailing={
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <DeltaValue delta={item.delta} />
                  <AverageValue ratio={item.ratio} size="callout" colored />
                </View>
              }
            />
          ))}
        </>
      );

    case "distribution":
      return (
        <View style={{ gap: space.sm }}>
          <Distribution buckets={result.buckets} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Label>{t("Weak")}</Label>
            <Text style={[type.footnote, { color: palette.textFaint }]}>
              {t("{count} grades", { count: result.total })}
            </Text>
            <Label>{t("Strong")}</Label>
          </View>
        </View>
      );

    case "streak":
      return (
        <View style={{ gap: space.xs }}>
          <View
            style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}
          >
            <Text style={[type.display, { color: palette.text }]}>
              {String(result.current)}
            </Text>
            <Text
              style={[
                type.footnote,
                { color: palette.textMuted, paddingBottom: 6 },
              ]}
            >
              {result.alive ? t("and counting") : t("right now")}
            </Text>
          </View>
          <Text style={[type.footnote, { color: palette.textFaint }]}>
            {t("Best this year: {count}", { count: result.longest })}
          </Text>
        </View>
      );

    case "goal":
      return (
        <View style={{ gap: space.sm }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <AverageValue ratio={result.plan.current} size="display" colored />
            <Text style={[type.footnote, { color: palette.textFaint }]}>
              {t("of")}
            </Text>
            <AverageValue ratio={result.plan.target} size="callout" />
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <StatusPill status={result.plan.status} />
            </View>
          </View>
          <ProgressBar
            value={
              result.plan.current === null || result.plan.target === 0
                ? 0
                : result.plan.current / result.plan.target
            }
            done={
              result.plan.status === "achieved" ||
              result.plan.status === "secured"
            }
          />
        </View>
      );

    default:
      return null;
  }
}
