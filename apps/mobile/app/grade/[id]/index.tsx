import { Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/components/icon";
import {
  gradeImpact,
  gradeRatio,
  resolveCustomAverage,
} from "@avermate/core";
import { formatDate, formatNumber } from "@/components/format";
import {
  CoefficientTag,
  DeltaValue,
  PointsValue,
  ResultBadge,
} from "@/components/value";
import { Button, Card, Empty, Row, Screen, Section } from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * One result, and what it did — the same reading the web gives. A 12/20
 * means nothing on its own, and everything once you know it pulled the
 * subject down by 0.4 and the year by 0.05. Editing is one tap deeper.
 */
export default function GradeDetail() {
  const palette = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { customAverages, graph, yearGraph, scale, decimals } = useYear();

  // The everyday graph is period-scoped; a grade filed outside the selected
  // period still deserves a page, so the whole-year graph is the fallback.
  const inPeriod = graph.allGrades().some((item) => item.id === id);
  const activeGraph = inPeriod ? graph : yearGraph;
  const grade = activeGraph.allGrades().find((item) => item.id === id);

  if (!grade) {
    return (
      <>
        <Stack.Screen options={{ title: t("Grade") }} />
        <Screen>
          <Empty
            icon="document-text-outline"
            title={t("Grade not found")}
            body={t("It may have been deleted, or it belongs to another year.")}
            action={
              <Button
                label={t("Back")}
                variant="secondary"
                onPress={() => router.back()}
              />
            }
          />
        </Screen>
      </>
    );
  }

  const subject = activeGraph.byId(grade.subjectId);
  const impacts = [
    {
      id: `subject:${grade.subjectId}`,
      label: subject?.name ?? t("Subject"),
      href: subject ? `/subject/${subject.id}` : undefined,
      impact: gradeImpact(activeGraph, grade.id, grade.subjectId),
    },
    ...activeGraph.ancestorsOf(grade.subjectId).map((ancestor) => ({
      id: `subject:${ancestor.id}`,
      label: ancestor.name,
      href: `/subject/${ancestor.id}`,
      impact: gradeImpact(activeGraph, grade.id, ancestor.id),
    })),
    {
      id: "general",
      label: t("General average"),
      href: "/average/general",
      impact: gradeImpact(activeGraph, grade.id, null),
    },
    ...customAverages.flatMap((average) => {
      const resolved = resolveCustomAverage(activeGraph, average);
      if (!resolved.graph.has(grade.subjectId)) return [];
      return [
        {
          id: `custom:${average.id}`,
          label: average.name,
          href: `/average/${average.id}`,
          impact: gradeImpact(
            resolved.graph,
            grade.id,
            null,
            resolved.scope,
          ),
        },
      ];
    }),
  ];

  const arrow = (value: number | null) =>
    value === null ? "—" : formatNumber(value * scale, decimals);

  return (
    <>
      <Stack.Screen
        options={{
          title: grade.name,
          headerRight: () => (
            <Pressable
              accessibilityLabel={t("Edit grade")}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => {
                haptic("light");
                router.push(`/grade/${grade.id}/edit`);
              }}
              style={{
                width: 34,
                height: 34,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: palette.accentSoft,
              }}
            >
              <Icon
                name="pencil-outline"
                size={17}
                color={palette.accent}
              />
            </Pressable>
          ),
        }}
      />
      <Screen>
        <Card
          style={{
            alignItems: "center",
            gap: space.sm,
            paddingVertical: space.xl,
          }}
        >
          <ResultBadge ratio={gradeRatio(grade)} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <PointsValue value={grade.value} outOf={grade.outOf} />
            <CoefficientTag coefficient={grade.coefficient} />
          </View>
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {subject ? `${subject.name} · ` : ""}
            {formatDate(grade.passedAt)}
          </Text>
        </Card>

        <Section title={t("Impact on averages")}>
          <Card padded={false}>
            {impacts.map((entry, index) => (
              <Row
                key={entry.id}
                first={index === 0}
                title={entry.label}
                subtitle={`${arrow(entry.impact.withoutValue)} → ${arrow(
                  entry.impact.withValue,
                )}`}
                onPress={
                  entry.href
                    ? () => {
                        const href = entry.href;
                        if (href) router.push(href as never);
                      }
                    : undefined
                }
                trailing={<DeltaValue delta={entry.impact.delta} size="callout" />}
              />
            ))}
          </Card>
        </Section>

        {grade.components.length > 0 ? (
          <Section title={t("What it is made of")}>
            <Card padded={false}>
              {grade.components.map((component, index) => (
                <Row
                  key={component.id}
                  first={index === 0}
                  title={component.name}
                  trailing={
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                      }}
                    >
                      <CoefficientTag coefficient={component.coefficient} />
                      <PointsValue
                        value={component.value}
                        outOf={component.outOf}
                      />
                      <ResultBadge ratio={gradeRatio(component)} />
                    </View>
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

        {grade.note ? (
          <Section title={t("Note")}>
            <Card>
              <Text selectable style={[type.body, { color: palette.text }]}>
                {grade.note}
              </Text>
            </Card>
          </Section>
        ) : null}

        <Button
          label={t("Edit grade")}
          variant="secondary"
          icon="pencil-outline"
          onPress={() => router.push(`/grade/${grade.id}/edit`)}
        />
      </Screen>
    </>
  );
}
