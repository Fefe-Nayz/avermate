import { Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/components/icon";
import { gradeImpact, gradeRatio, resolveCustomAverage } from "@avermate/core";
import { formatNumber } from "@/components/format";
import {
  CoefficientTag,
  DeltaValue,
  PointsValue,
  ResultBadge,
} from "@/components/value";
import {
  Button,
  Card,
  Empty,
  Loading,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { locale, t } from "@/lib/i18n";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

/**
 * One result, and what it did — the same reading the web gives. A 12/20
 * means nothing on its own, and everything once you know it pulled the
 * subject down by 0.4 and the year by 0.05. Editing is one tap deeper.
 */
export default function GradeDetail() {
  const palette = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { customAverages, graph, yearGraph, scale, isLoading } = useYear();

  // The everyday graph is period-scoped; a grade filed outside the selected
  // period still deserves a page, so the whole-year graph is the fallback.
  const inPeriod = graph.allGrades().some((item) => item.id === id);
  const activeGraph = inPeriod ? graph : yearGraph;
  const grade = activeGraph.allGrades().find((item) => item.id === id);

  if (!grade) {
    if (isLoading) return <Loading />;
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
                label={t("Back to grades")}
                variant="outline"
                onPress={() => router.dismissTo("/(tabs)/grades")}
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
          impact: gradeImpact(resolved.graph, grade.id, null, resolved.scope),
        },
      ];
    }),
  ];

  // The web's impact grid drops scopes with nothing to compare and disappears
  // entirely when none are left.
  const available = impacts.filter(
    (entry) =>
      entry.impact.withValue !== null || entry.impact.withoutValue !== null,
  );

  // Before-and-after at two decimals, as the web's impact grid prints them.
  const arrow = (value: number | null) =>
    value === null ? "—" : formatNumber(value * scale, 2);

  const tag = locale() === "fr" ? "fr-FR" : "en-GB";

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
              <Icon name="pencil-outline" size={17} color={palette.accent} />
            </Pressable>
          ),
        }}
      />
      <Screen>
        {/* The web's subtitle under the title: the subject, as a link. */}
        {subject ? (
          <Pressable
            accessibilityRole="link"
            hitSlop={6}
            onPress={() => {
              haptic("light");
              router.push(`/subject/${subject.id}`);
            }}
            style={{ alignSelf: "flex-start", marginBottom: -space.sm }}
          >
            <Text style={[type.callout, { color: palette.textMuted }]}>
              {subject.name}
            </Text>
          </Pressable>
        ) : null}

        <Card
          style={{
            alignItems: "center",
            gap: space.sm,
            paddingVertical: space.xl,
          }}
        >
          <ResultBadge ratio={gradeRatio(grade)} />
          <Text
            style={[
              type.footnote,
              { color: palette.textMuted, textAlign: "center" },
            ]}
          >
            <PointsValue value={grade.value} outOf={grade.outOf} />
            {grade.coefficient !== 1 ? (
              <Text
                style={[type.footnote, numeric, { color: palette.textMuted }]}
              >
                {" · "}
                {t("weight {coefficient}", {
                  coefficient: grade.coefficient.toLocaleString(tag, {
                    maximumFractionDigits: 2,
                  }),
                })}
              </Text>
            ) : null}
          </Text>
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {grade.passedAt.toLocaleDateString(tag, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </Text>
        </Card>

        {available.length > 0 ? (
          <Section title={t("Impact on averages")}>
            <Card padded={false}>
              {available.map((entry, index) => (
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
                  trailing={
                    <DeltaValue delta={entry.impact.delta} size="callout" />
                  }
                />
              ))}
            </Card>
          </Section>
        ) : null}

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
                      <ResultBadge ratio={gradeRatio(component)} />
                      <PointsValue
                        value={component.value}
                        outOf={component.outOf}
                      />
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
              <Text
                selectable
                style={[type.body, { color: palette.textMuted }]}
              >
                {grade.note}
              </Text>
            </Card>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
