import { Column, Spacer } from "@expo/ui";
import type { CardResult, CardSpec } from "@avermate/core";
import { Label, Line, Row, Section, Text } from "@/components/native";
import { AverageValue, DeltaValue, PercentValue } from "@/components/value";
import { Distribution, ProgressBar, Sparkline } from "@/components/chart";
import { StatusPill } from "@/components/goal-status";
import { metricLabel } from "@/components/use-cards";
import { formatDay } from "@/components/format";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

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
  const title = spec.title ?? metricLabel(spec.metric);

  if (!result || result.kind === "empty") {
    return (
      <Section title={title}>
        <Line title={t("Nothing to show yet")} onPress={onPress} />
      </Section>
    );
  }

  return (
    <Section title={title}>
      <Body spec={spec} result={result} onPress={onPress} />
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
  switch (result.kind) {
    case "ratio":
      return (
        <Column spacing={space.sm}>
          <Row spacing={space.sm} alignment="end">
            <AverageValue ratio={result.ratio} size="display" showScale colored />
            <DeltaValue delta={result.delta} size="callout" />
          </Row>
          {result.series && result.series.length > 2 ? (
            <Sparkline
              series={result.series}
              positive={(result.delta ?? 0) >= 0}
            />
          ) : null}
        </Column>
      );

    case "count":
      return (
        <Column spacing={space.sm}>
          <Text size="display" mono>
            {String(result.count)}
          </Text>
          {result.series && result.series.length > 2 ? (
            <Sparkline series={result.series} />
          ) : null}
        </Column>
      );

    case "percent":
      return (
        <Column spacing={space.sm}>
          <PercentValue ratio={result.ratio} size="display" />
          {spec.display === "gauge" ? (
            <ProgressBar value={result.ratio ?? 0} />
          ) : null}
        </Column>
      );

    case "scalar":
      return (
        <Text size="display" mono>
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
        <Line
          title={result.name}
          onPress={onPress}
          trailing={
            <Row spacing={space.sm}>
              <DeltaValue delta={result.delta} />
              <AverageValue ratio={result.ratio} size="heading" colored />
            </Row>
          }
        />
      );

    case "grade":
      return (
        <Line
          title={result.name}
          detail={`${result.subjectName} · ${formatDay(result.at)}`}
          onPress={onPress}
          trailing={<AverageValue ratio={result.ratio} size="heading" colored />}
        />
      );

    case "list":
      return (
        <>
          {result.items.map((item) => (
            <Line
              key={item.id}
              title={item.label}
              trailing={
                <Row spacing={space.sm}>
                  <DeltaValue delta={item.delta} />
                  <AverageValue ratio={item.ratio} size="callout" colored />
                </Row>
              }
            />
          ))}
        </>
      );

    case "distribution":
      return (
        <Column spacing={space.sm}>
          <Distribution buckets={result.buckets} />
          <Row>
            <Label>{t("Weak")}</Label>
            <Spacer flexible />
            <Text size="footnote" tone="faint">
              {t("{count} grades", { count: result.total })}
            </Text>
            <Spacer flexible />
            <Label>{t("Strong")}</Label>
          </Row>
        </Column>
      );

    case "streak":
      return (
        <Column spacing={space.xs}>
          <Row spacing={space.sm} alignment="end">
            <Text size="display" mono>
              {String(result.current)}
            </Text>
            <Text size="footnote" tone="muted">
              {result.alive ? t("and counting") : t("right now")}
            </Text>
          </Row>
          <Text size="footnote" tone="faint">
            {t("Best this year: {count}", { count: result.longest })}
          </Text>
        </Column>
      );

    case "goal":
      return (
        <Column spacing={space.sm}>
          <Row spacing={space.sm} alignment="end">
            <AverageValue ratio={result.plan.current} size="display" colored />
            <Text size="footnote" tone="faint">
              {t("of")}
            </Text>
            <AverageValue ratio={result.plan.target} size="callout" />
            <Spacer flexible />
            <StatusPill status={result.plan.status} />
          </Row>
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
        </Column>
      );

    default:
      return null;
  }
}
