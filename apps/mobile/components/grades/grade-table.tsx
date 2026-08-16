import { ScrollView, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { gradeRatio, resolveCustomAverage, type Subject } from "@avermate/core";
import { Icon } from "@/components/icon";
import { Card, Empty } from "@/components/ui";
import { AverageValue, CoefficientTag, ResultBadge } from "@/components/value";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";
import { gradeTableRows, newestFirst } from "./grade-views";

/**
 * The web's hierarchical table, phone-sized: one row per subject with its
 * badges laid out beside it, and the averages — general and custom — as the
 * footer. The columns need more width than a phone has, so the card scrolls
 * sideways, exactly what the web table does below its breakpoint.
 */

const SUBJECT_WIDTH = 200;
const GRADES_WIDTH = 264;
const AVERAGE_WIDTH = 108;

/** The web indents 0.9rem per level and stops counting at six. */
const INDENT_STEP = 14;
const INDENT_CAP = 6;

export function GradeTable({ query }: { query: string }) {
  const palette = usePalette();
  const router = useRouter();
  const { graph, customAverages } = useYear();

  const rows = gradeTableRows(graph, query);

  if (rows.length === 0) {
    return <Empty icon="search-outline" title={t("No grade matches.")} />;
  }

  return (
    <Card padded={false}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={{ flexGrow: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: 40,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: palette.hairline,
            }}
          >
            <Text
              style={[
                type.callout,
                {
                  width: SUBJECT_WIDTH,
                  paddingHorizontal: space.lg,
                  color: palette.text,
                },
              ]}
            >
              {t("Subject")}
            </Text>
            <Text
              style={[
                type.callout,
                {
                  flex: 1,
                  minWidth: GRADES_WIDTH,
                  paddingHorizontal: space.sm,
                  color: palette.text,
                },
              ]}
            >
              {t("Grades")}
            </Text>
            <Text
              style={[
                type.callout,
                {
                  width: AVERAGE_WIDTH,
                  paddingHorizontal: space.lg,
                  textAlign: "right",
                  color: palette.text,
                },
              ]}
            >
              {t("Average")}
            </Text>
          </View>

          {rows.map(({ subject, depth }, index) => (
            <SubjectRow
              key={subject.id}
              subject={subject}
              depth={depth}
              first={index === 0}
            />
          ))}

          <FooterRow
            first
            label={t("General average")}
            ratio={graph.ratio(null)}
            onPress={() => router.push("/average/general")}
          />
          {customAverages.map((average) => {
            const resolved = resolveCustomAverage(graph, average);
            return (
              <FooterRow
                key={average.id}
                label={average.name}
                ratio={resolved.graph.ratio(null, resolved.scope)}
                onPress={() => router.push(`/average/${average.id}`)}
              />
            );
          })}
        </View>
      </ScrollView>
    </Card>
  );
}

function SubjectRow({
  subject,
  depth,
  first,
}: {
  subject: Subject;
  depth: number;
  first: boolean;
}) {
  const palette = usePalette();
  const router = useRouter();
  const { graph } = useYear();
  const category = subject.kind === "category";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: palette.hairline,
      }}
    >
      <View
        style={{
          width: SUBJECT_WIDTH,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingLeft: space.lg + Math.min(depth, INDENT_CAP) * INDENT_STEP,
          paddingRight: space.sm,
        }}
      >
        <Pressable
          hitSlop={6}
          accessibilityRole="button"
          onPress={() => {
            haptic("selection");
            router.push(`/subject/${subject.id}`);
          }}
          style={({ pressed }) => ({
            flexShrink: 1,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text
            numberOfLines={1}
            style={
              category
                ? [type.label, { color: palette.textMuted }]
                : [type.callout, { color: palette.text }]
            }
          >
            {subject.name}
          </Text>
        </Pressable>
        <CoefficientTag coefficient={subject.coefficient} />
      </View>

      <View
        style={{
          flex: 1,
          minWidth: GRADES_WIDTH,
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.sm,
          paddingVertical: space.sm,
        }}
      >
        {subject.grades.length === 0 ? (
          <Text style={[type.caption, { color: palette.textFaint }]}>—</Text>
        ) : (
          newestFirst(subject.grades).map((grade) => (
            <Pressable
              key={grade.id}
              accessibilityRole="button"
              accessibilityLabel={grade.name}
              onPress={() => {
                haptic("selection");
                router.push(`/grade/${grade.id}`);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <ResultBadge ratio={gradeRatio(grade)} />
            </Pressable>
          ))
        )}
      </View>

      <View
        style={{
          width: AVERAGE_WIDTH,
          alignItems: "flex-end",
          paddingHorizontal: space.lg,
        }}
      >
        <AverageValue
          ratio={graph.ratio(subject.id)}
          size="callout"
          showScale
          colored
        />
      </View>
    </View>
  );
}

/** An average as a destination: the general one, then each custom one. */
function FooterRow({
  label,
  ratio,
  onPress,
  first = false,
}: {
  label: string;
  ratio: number | null;
  onPress: () => void;
  first?: boolean;
}) {
  const palette = usePalette();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        borderTopWidth: StyleSheet.hairlineWidth,
        // The first footer row separates averages from subjects, so it gets
        // the stronger border tone.
        borderTopColor: first ? palette.border : palette.hairline,
        backgroundColor: pressed ? palette.accentSoft : "transparent",
      })}
    >
      <View
        style={{
          flex: 1,
          minWidth: SUBJECT_WIDTH + GRADES_WIDTH,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.lg,
        }}
      >
        <Text
          style={[type.callout, { color: palette.text, fontWeight: "600" }]}
        >
          {label}
        </Text>
        <Icon name="chevron-forward" size={14} color={palette.textFaint} />
      </View>
      <View
        style={{
          width: AVERAGE_WIDTH,
          alignItems: "flex-end",
          paddingHorizontal: space.lg,
        }}
      >
        <AverageValue
          ratio={ratio}
          size="callout"
          showScale
          colored
          style={{ fontWeight: "600" }}
        />
      </View>
    </Pressable>
  );
}
