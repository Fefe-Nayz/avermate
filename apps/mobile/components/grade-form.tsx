import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Icon } from "@/components/icon";
import type { Grade, Subject } from "@avermate/core";
import { FULL_YEAR_PERIOD_ID, gradeRatio } from "@avermate/core";
import { Button, Card, Label, Note, Problem, Screen } from "@/components/ui";
import { AverageValue, DeltaValue } from "@/components/value";
import {
  FieldGroup,
  PickerField,
  SwitchField,
  TextField,
  type Choice,
} from "@/components/field";
import { DateField } from "@/components/date-field";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

/**
 * The screen the app lives or dies on.
 *
 * Somebody types here a few times a week for a year, so it is a screen, not a
 * sheet: full height, a pinned save button, real keyboards, and a preview that
 * answers the only question anyone actually has while typing — "what does this
 * do to my average?" — before they commit to it. The order of decisions is the
 * web form's: which subject, what result, when.
 */

export interface ComponentDraft {
  key: string;
  name: string;
  value: string;
  outOf: string;
  coefficient: string;
}

export interface GradeDraft {
  name: string;
  value: string;
  outOf: string;
  coefficient: string;
  subjectId: string | null;
  /** `null` lets the server work it out from the date. */
  periodId: string | null;
  passedAt: Date;
  note: string;
  components: ComponentDraft[];
}

export interface GradePayload {
  name: string;
  value: number;
  outOf: number;
  coefficient: number;
  subjectId: string;
  periodId: string | null;
  passedAt: Date;
  note: string | null;
  components: Array<{
    name: string;
    value: number;
    outOf: number;
    coefficient: number;
  }>;
}

/** French keyboards give a comma; nobody should have to think about that. */
export function parseNumber(input: string): number | null {
  const normalised = input.replace(",", ".").trim();
  if (normalised === "") return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/**
 * Weighted roll-up of the parts, mirroring what the server will store. A part
 * that is not filled in yet is skipped rather than blocking the whole figure,
 * exactly as on the web — typing the first result shows a total immediately.
 */
function rollUp(components: ComponentDraft[], outOf: number): number | null {
  let weighted = 0;
  let total = 0;
  for (const part of components) {
    const value = parseNumber(part.value);
    const partOutOf = parseNumber(part.outOf);
    const coefficient = parseNumber(part.coefficient) ?? 1;
    if (value === null || partOutOf === null || partOutOf <= 0) continue;
    if (coefficient <= 0) continue;
    weighted += (value / partOutOf) * coefficient;
    total += coefficient;
  }
  if (total === 0) return null;
  return (weighted / total) * outOf;
}

export function emptyDraft(
  defaultOutOf: number,
  subjectId?: string,
): GradeDraft {
  return {
    name: "",
    value: "",
    outOf: String(defaultOutOf),
    coefficient: "1",
    subjectId: subjectId ?? null,
    periodId: null,
    passedAt: new Date(),
    note: "",
    components: [],
  };
}

export function draftOf(grade: Grade, subjectId: string): GradeDraft {
  return {
    name: grade.name,
    value: String(grade.value),
    outOf: String(grade.outOf),
    coefficient: String(grade.coefficient),
    subjectId,
    periodId: grade.periodId,
    passedAt: new Date(grade.passedAt),
    note: grade.note ?? "",
    components: grade.components.map((part, index) => ({
      key: `${part.id}-${index}`,
      name: part.name,
      value: String(part.value),
      outOf: String(part.outOf),
      coefficient: String(part.coefficient),
    })),
  };
}

/** Depth-first list of every subject that can hold a grade. */
export function subjectChoices(
  roots: readonly Subject[],
  childrenOf: (id: string) => readonly Subject[],
  depth = 0,
): Choice[] {
  return [...roots]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .flatMap((subject) => [
      {
        value: subject.id,
        label: subject.name,
        depth,
        // A category is a grouping, not a place results live.
        hint: subject.kind === "category" ? t("group") : undefined,
        disabled: subject.kind === "category",
      },
      ...subjectChoices(childrenOf(subject.id), childrenOf, depth + 1),
    ]);
}

export function GradeForm({
  draft,
  onChange,
  onSubmit,
  submitLabel,
  busy,
  error,
  excludeGradeId,
  intro,
  extra,
}: {
  draft: GradeDraft;
  onChange: (draft: GradeDraft) => void;
  onSubmit: (payload: GradePayload) => void;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  /** In edit mode, the grade being replaced must leave the baseline. */
  excludeGradeId?: string;
  /** The line the web shows under the title, e.g. where the grade will land. */
  intro?: string;
  extra?: React.ReactNode;
}) {
  const palette = usePalette();
  const { graph, year, periods } = useYear();
  const [touched, setTouched] = useState(false);
  // "Made of several parts" is a mode, not just a list: switching it off keeps
  // the parts around (the web does the same), so an accidental toggle loses
  // nothing.
  const [composite, setComposite] = useState(draft.components.length > 0);

  const choices = useMemo(
    () => subjectChoices(graph.roots, (id) => graph.childrenOf(id)),
    [graph],
  );

  // A grade normally lands in whichever period contains its date; this is for
  // the exceptions — a catch-up test marked against the previous term.
  const periodChoices = useMemo<Choice[]>(
    () => [
      { value: "", label: t("Work it out from the date") },
      ...periods
        .filter((item) => item.id !== FULL_YEAR_PERIOD_ID)
        .map((item) => ({ value: item.id, label: item.name })),
    ],
    [periods],
  );

  const outOf = parseNumber(draft.outOf);
  const effectiveValue = composite
    ? outOf === null
      ? null
      : rollUp(draft.components, outOf)
    : parseNumber(draft.value);
  const coefficient = parseNumber(draft.coefficient) ?? 1;

  // The web form's validation, message for message.
  const problems = {
    name: draft.name.trim().length === 0 ? t("Give this grade a name.") : null,
    subject: !draft.subjectId ? t("Pick the subject it belongs to.") : null,
    outOf:
      outOf === null || outOf <= 0
        ? t("The maximum must be above zero.")
        : null,
    value:
      !composite && effectiveValue === null
        ? t("Enter the result you were given.")
        : effectiveValue !== null && outOf !== null && effectiveValue > outOf
          ? t("A grade cannot be worth more than its maximum.")
          : null,
    components: !composite
      ? null
      : draft.components.length === 0
        ? t("Add at least one part.")
        : effectiveValue === null
          ? t("Fill in the result of at least one part.")
          : null,
  };
  const valid =
    !problems.name &&
    !problems.subject &&
    !problems.outOf &&
    !problems.value &&
    !problems.components;

  // The whole point of the screen: the answer before the commitment. Like the
  // web, it appears as soon as subject and result exist — a name is required
  // to save, not to wonder.
  const preview = useMemo(() => {
    if (
      !draft.subjectId ||
      effectiveValue === null ||
      outOf === null ||
      outOf <= 0
    ) {
      return null;
    }

    // When editing, the grade being changed must not count twice — drop it
    // wherever it currently sits, then add the edited version to the subject
    // now selected, which may not be the one it came from.
    const base = excludeGradeId
      ? graph.withSubjects((subject) => ({
          ...subject,
          grades: subject.grades.filter((grade) => grade.id !== excludeGradeId),
        }))
      : graph;

    const hypothetical: Grade = {
      id: "__draft__",
      name: draft.name,
      value: effectiveValue,
      outOf,
      coefficient,
      passedAt: draft.passedAt,
      createdAt: new Date(),
      subjectId: draft.subjectId,
      periodId: null,
      components: [],
    };

    const next = base.withSubjects((subject) =>
      subject.id === draft.subjectId
        ? { ...subject, grades: [...subject.grades, hypothetical] }
        : subject,
    );

    return {
      general: { before: base.ratio(null), after: next.ratio(null) },
      subject: {
        before: base.ratio(draft.subjectId),
        after: next.ratio(draft.subjectId),
      },
    };
  }, [draft, effectiveValue, outOf, coefficient, graph, excludeGradeId]);

  const previewRatio =
    effectiveValue !== null && outOf !== null && outOf > 0
      ? gradeRatio({ value: effectiveValue, outOf })
      : null;
  const generalDelta =
    preview && preview.general.before !== null && preview.general.after !== null
      ? preview.general.after - preview.general.before
      : null;

  const subjectName = draft.subjectId
    ? (graph.byId(draft.subjectId)?.name ?? "")
    : "";

  const submit = () => {
    setTouched(true);
    if (
      !valid ||
      effectiveValue === null ||
      outOf === null ||
      !draft.subjectId
    ) {
      haptic("warning");
      return;
    }
    onSubmit({
      name: draft.name.trim(),
      value: effectiveValue,
      outOf,
      coefficient,
      subjectId: draft.subjectId,
      periodId: draft.periodId,
      passedAt: draft.passedAt,
      note: draft.note.trim() || null,
      components: composite
        ? draft.components.map((part) => ({
            name: part.name.trim() || t("Part"),
            value: parseNumber(part.value) ?? 0,
            outOf: parseNumber(part.outOf) ?? 20,
            coefficient: parseNumber(part.coefficient) ?? 1,
          }))
        : [],
    });
  };

  const patch = (values: Partial<GradeDraft>) =>
    onChange({ ...draft, ...values });

  const patchPart = (index: number, values: Partial<ComponentDraft>) =>
    patch({
      components: draft.components.map((item, at) =>
        at === index ? { ...item, ...values } : item,
      ),
    });

  const addComponent = () => {
    haptic("light");
    patch({
      components: [
        ...draft.components,
        {
          key: `part-${Date.now()}`,
          name: "",
          value: "",
          outOf: draft.outOf,
          coefficient: "1",
        },
      ],
    });
  };

  const toggleComposite = (next: boolean) => {
    haptic("selection");
    setComposite(next);
    if (next && draft.components.length === 0) addComponent();
  };

  // One tap to the scales every French school uses.
  const quickScales = [10, 20, 100].filter((candidate) => candidate !== outOf);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <Screen
        footer={<Button label={submitLabel} onPress={submit} loading={busy} />}
      >
        {intro ? <Note>{intro}</Note> : null}

        <FieldGroup>
          <PickerField
            label={t("Which subject is this for?")}
            choices={choices}
            value={draft.subjectId}
            onChange={(subjectId) => patch({ subjectId })}
            placeholder={t("Choose a subject")}
            emptyHint={t("This year has no subjects yet.")}
            error={touched ? (problems.subject ?? undefined) : undefined}
          />

          <TextField
            label={t("Name")}
            value={draft.name}
            onChangeText={(name) => patch({ name })}
            placeholder={t("Mock exam, chapter 4, oral…")}
            error={touched ? (problems.name ?? undefined) : undefined}
          />

          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              {composite ? (
                // Stands in for the result field at the same height, so the
                // row it shares with "Out of" comes out even.
                <View style={{ gap: space.sm }}>
                  <Text style={[type.label, { color: palette.textFaint }]}>
                    {t("Result")}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: space.sm,
                      minHeight: 52,
                      paddingHorizontal: space.md,
                      borderRadius: radius.md,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor:
                        touched && problems.value
                          ? palette.negative
                          : palette.border,
                      backgroundColor: palette.accentSoft,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        type.footnote,
                        { flexShrink: 1, color: palette.textMuted },
                      ]}
                    >
                      {t("Rolls up to")}
                    </Text>
                    <Text
                      style={[
                        type.body,
                        numeric,
                        { color: palette.text, fontWeight: "500" },
                      ]}
                    >
                      {effectiveValue === null
                        ? "—"
                        : effectiveValue.toFixed(2).replace(/\.00$/, "")}
                    </Text>
                  </View>
                  {touched && problems.value ? (
                    <Text style={[type.footnote, { color: palette.negative }]}>
                      {problems.value}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <TextField
                  label={t("Result")}
                  value={draft.value}
                  onChangeText={(next) => patch({ value: next })}
                  keyboardType="decimal-pad"
                  align="right"
                  placeholder="14"
                  error={touched ? (problems.value ?? undefined) : undefined}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label={t("Out of")}
                value={draft.outOf}
                onChangeText={(next) => patch({ outOf: next })}
                keyboardType="decimal-pad"
                align="right"
                error={touched ? (problems.outOf ?? undefined) : undefined}
              />
            </View>
          </View>

          {quickScales.length > 0 ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.sm,
                marginTop: -space.xs,
              }}
            >
              {quickScales.map((candidate) => (
                <Pressable
                  key={candidate}
                  accessibilityRole="button"
                  onPress={() => {
                    haptic("selection");
                    patch({ outOf: String(candidate) });
                  }}
                  style={({ pressed }) => ({
                    minHeight: 36,
                    justifyContent: "center",
                    paddingHorizontal: space.md,
                    borderRadius: radius.pill,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: palette.border,
                    backgroundColor: pressed
                      ? palette.accentSoft
                      : "transparent",
                  })}
                >
                  <Text
                    style={[
                      type.footnote,
                      numeric,
                      { color: palette.textMuted },
                    ]}
                  >
                    {t("/ {scale}", { scale: candidate })}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={{ gap: space.sm }}>
            <TextField
              label={t("Weight")}
              value={draft.coefficient}
              onChangeText={(next) => patch({ coefficient: next })}
              keyboardType="decimal-pad"
              align="right"
            />
            <Note>
              {t(
                "How much this counts inside the subject. 1 is a normal result.",
              )}
            </Note>
          </View>

          {preview && previewRatio !== null ? (
            <Card
              style={
                generalDelta !== null && generalDelta > 0
                  ? { borderColor: palette.positive + "66" }
                  : generalDelta !== null && generalDelta < 0
                    ? { borderColor: palette.negative + "66" }
                    : undefined
              }
            >
              <View style={{ gap: space.md }}>
                <Label>{t("If you save this")}</Label>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    columnGap: space.md,
                    rowGap: space.xs,
                  }}
                >
                  <AverageValue
                    ratio={previewRatio}
                    size="title"
                    showScale
                    colored
                  />
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {t("general average")}
                  </Text>
                  <AverageValue ratio={preview.general.after} size="callout" />
                  <DeltaValue delta={generalDelta} size="callout" />
                </View>
                {subjectName ? (
                  <PreviewRow
                    label={subjectName}
                    before={preview.subject.before}
                    after={preview.subject.after}
                  />
                ) : null}
              </View>
            </Card>
          ) : null}

          {/* Below everything and behind a rule: most grades are one mark, so
              this is a departure from the normal shape rather than part of it. */}
          <View
            style={{
              marginTop: space.xs,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.hairline,
              paddingTop: space.lg,
              gap: space.md,
            }}
          >
            <SwitchField
              label={t("This grade is made of several parts")}
              hint={
                composite
                  ? t("Use a single result")
                  : t(
                      "Written and oral, or several exercises with their own weights",
                    )
              }
              value={composite}
              onValueChange={toggleComposite}
            />

            {composite ? (
              <>
                {draft.components.map((part, index) => (
                  <Card key={part.key}>
                    <View style={{ gap: space.md }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <TextField
                            label={t("Part {number}", { number: index + 1 })}
                            value={part.name}
                            onChangeText={(name) => patchPart(index, { name })}
                            placeholder={t("Written, oral…")}
                          />
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("Delete")}
                          onPress={() => {
                            haptic("light");
                            patch({
                              components: draft.components.filter(
                                (_, at) => at !== index,
                              ),
                            });
                          }}
                          hitSlop={10}
                          style={{ paddingTop: space.lg }}
                        >
                          <Icon
                            name="trash-outline"
                            size={20}
                            color={palette.textFaint}
                          />
                        </Pressable>
                      </View>

                      {/* Three number fields side by side leaves each one
                          about forty pixels wide on a phone. Two, then one. */}
                      <View style={{ flexDirection: "row", gap: space.sm }}>
                        <View style={{ flex: 1 }}>
                          <TextField
                            label={t("Result")}
                            value={part.value}
                            onChangeText={(next) =>
                              patchPart(index, { value: next })
                            }
                            keyboardType="decimal-pad"
                            align="right"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <TextField
                            label={t("Out of")}
                            value={part.outOf}
                            onChangeText={(next) =>
                              patchPart(index, { outOf: next })
                            }
                            keyboardType="decimal-pad"
                            align="right"
                          />
                        </View>
                      </View>
                      <TextField
                        label={t("Weight")}
                        value={part.coefficient}
                        onChangeText={(next) =>
                          patchPart(index, { coefficient: next })
                        }
                        keyboardType="decimal-pad"
                        align="right"
                      />
                    </View>
                  </Card>
                ))}

                <Button
                  label={t("Add a part")}
                  onPress={addComponent}
                  variant="outline"
                  icon="add"
                />

                {touched && problems.components ? (
                  <Problem>{problems.components}</Problem>
                ) : null}
              </>
            ) : null}
          </View>

          <DateField
            label={t("Date")}
            value={draft.passedAt}
            onChange={(passedAt) => patch({ passedAt })}
            min={year ? new Date(year.startsAt) : undefined}
          />

          {periodChoices.length > 1 ? (
            <PickerField
              label={t("Period")}
              choices={periodChoices}
              value={draft.periodId ?? ""}
              onChange={(periodId) => patch({ periodId: periodId || null })}
            />
          ) : null}

          <TextField
            label={t("Anything to remember?")}
            value={draft.note}
            onChangeText={(note) => patch({ note })}
            placeholder={t("Careless mistakes, missed the last question…")}
            multiline
            maxLength={500}
          />
        </FieldGroup>

        {error ? <Problem>{error}</Problem> : null}

        {extra}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function PreviewRow({
  label,
  before,
  after,
}: {
  label: string;
  before: number | null;
  after: number | null;
}) {
  const palette = usePalette();
  const delta = before === null || after === null ? null : after - before;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Text
        numberOfLines={1}
        style={[type.body, { flex: 1, color: palette.textMuted }]}
      >
        {label}
      </Text>
      <AverageValue ratio={before} size="callout" />
      <Icon name="arrow-forward" size={13} color={palette.textFaint} />
      <AverageValue ratio={after} size="callout" colored />
      <View
        style={{
          minWidth: 54,
          alignItems: "flex-end",
          paddingLeft: space.xs,
          borderLeftWidth: 1,
          borderLeftColor: palette.hairline,
          borderRadius: radius.sm,
        }}
      >
        <DeltaValue delta={delta} size="callout" />
      </View>
    </View>
  );
}
