import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Grade, Subject } from "@avermate/core";
import { FULL_YEAR_PERIOD_ID } from "@avermate/core";
import { Button, Card, Label, Screen } from "@/components/ui";
import { AverageValue, DeltaValue } from "@/components/value";
import { FieldGroup, PickerField, TextField, type Choice } from "@/components/field";
import { DateField } from "@/components/date-field";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * The screen the app lives or dies on.
 *
 * Somebody types here a few times a week for a year, so it is a screen, not a
 * sheet: full height, a pinned save button, real keyboards, and a preview that
 * answers the only question anyone actually has while typing — "what does this
 * do to my average?" — before they commit to it.
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

/** Weighted roll-up of the parts, mirroring what the server will store. */
function rollUp(components: ComponentDraft[], outOf: number): number | null {
  let weighted = 0;
  let total = 0;
  for (const part of components) {
    const value = parseNumber(part.value);
    const partOutOf = parseNumber(part.outOf);
    const coefficient = parseNumber(part.coefficient) ?? 1;
    if (value === null || partOutOf === null || partOutOf <= 0) return null;
    if (coefficient <= 0) continue;
    weighted += (value / partOutOf) * coefficient;
    total += coefficient;
  }
  if (total === 0) return null;
  return (weighted / total) * outOf;
}

export function emptyDraft(defaultOutOf: number, subjectId?: string): GradeDraft {
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
  extra?: React.ReactNode;
}) {
  const palette = usePalette();
  const { yearGraph, graph, year, periods } = useYear();
  const [touched, setTouched] = useState(false);

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

  const composite = draft.components.length > 0;
  const outOf = parseNumber(draft.outOf);
  const value = composite
    ? outOf === null
      ? null
      : rollUp(draft.components, outOf)
    : parseNumber(draft.value);
  const coefficient = parseNumber(draft.coefficient) ?? 1;

  const problems = {
    name: draft.name.trim().length === 0 ? t("Give this grade a name.") : null,
    subject: !draft.subjectId ? t("Pick the subject it belongs to.") : null,
    value:
      value === null
        ? t("Enter the result you were given.")
        : outOf !== null && value > outOf
          ? t("A grade cannot be worth more than its maximum.")
          : null,
  };
  const valid =
    !problems.name && !problems.subject && !problems.value && outOf !== null;

  // The whole point of the screen: the answer before the commitment.
  const preview = useMemo(() => {
    if (!valid || !draft.subjectId || value === null || outOf === null) {
      return null;
    }

    const base = excludeGradeId
      ? yearGraph.withSubjects((subject) => ({
          ...subject,
          grades: subject.grades.filter((grade) => grade.id !== excludeGradeId),
        }))
      : yearGraph;

    const hypothetical: Grade = {
      id: "__draft__",
      name: draft.name,
      value,
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
  }, [valid, draft, value, outOf, coefficient, yearGraph, excludeGradeId]);

  const subjectName = draft.subjectId
    ? (graph.byId(draft.subjectId)?.name ?? "")
    : "";

  const submit = () => {
    setTouched(true);
    if (!valid || value === null || outOf === null || !draft.subjectId) {
      haptic("error");
      return;
    }
    onSubmit({
      name: draft.name.trim(),
      value,
      outOf,
      coefficient,
      subjectId: draft.subjectId,
      periodId: draft.periodId,
      passedAt: draft.passedAt,
      note: draft.note.trim() || null,
      components: draft.components.map((part) => ({
        name: part.name.trim() || t("Part"),
        value: parseNumber(part.value) ?? 0,
        outOf: parseNumber(part.outOf) ?? 1,
        coefficient: parseNumber(part.coefficient) ?? 1,
      })),
    });
  };

  const patch = (values: Partial<GradeDraft>) =>
    onChange({ ...draft, ...values });

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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <Screen
        footer={
          <Button label={submitLabel} onPress={submit} loading={busy} />
        }
      >
        <FieldGroup>
          <TextField
            label={t("Name")}
            value={draft.name}
            onChangeText={(name) => patch({ name })}
            placeholder={t("Mock exam, chapter 4, oral…")}
            error={touched ? (problems.name ?? undefined) : undefined}
            autoFocus={!draft.subjectId}
          />

          <PickerField
            label={t("Which subject is this for?")}
            choices={choices}
            value={draft.subjectId}
            onChange={(subjectId) => patch({ subjectId })}
            placeholder={t("Choose a subject")}
            emptyHint={t("This year has no subjects yet.")}
            error={touched ? (problems.subject ?? undefined) : undefined}
          />

          {composite ? (
            <View style={{ gap: space.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Label>{t("Parts")}</Label>
                <Pressable
                  onPress={() => {
                    haptic("light");
                    patch({ components: [] });
                  }}
                  hitSlop={8}
                >
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {t("Use a single result")}
                  </Text>
                </Pressable>
              </View>

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
                          onChangeText={(name) =>
                            patch({
                              components: draft.components.map((item, at) =>
                                at === index ? { ...item, name } : item,
                              ),
                            })
                          }
                          placeholder={t("Written, oral…")}
                        />
                      </View>
                      <Pressable
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
                        <Ionicons
                          name="close-circle"
                          size={22}
                          color={palette.textFaint}
                        />
                      </Pressable>
                    </View>

                    <View style={{ flexDirection: "row", gap: space.sm }}>
                      <View style={{ flex: 1 }}>
                        <TextField
                          label={t("Result")}
                          value={part.value}
                          onChangeText={(next) =>
                            patch({
                              components: draft.components.map((item, at) =>
                                at === index ? { ...item, value: next } : item,
                              ),
                            })
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
                            patch({
                              components: draft.components.map((item, at) =>
                                at === index ? { ...item, outOf: next } : item,
                              ),
                            })
                          }
                          keyboardType="decimal-pad"
                          align="right"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <TextField
                          label={t("Weight")}
                          value={part.coefficient}
                          onChangeText={(next) =>
                            patch({
                              components: draft.components.map((item, at) =>
                                at === index
                                  ? { ...item, coefficient: next }
                                  : item,
                              ),
                            })
                          }
                          keyboardType="decimal-pad"
                          align="right"
                        />
                      </View>
                    </View>
                  </View>
                </Card>
              ))}

              <Button
                label={t("Add a part")}
                onPress={addComponent}
                variant="ghost"
                icon="add"
              />

              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t("Out of")}
                    value={draft.outOf}
                    onChangeText={(next) => patch({ outOf: next })}
                    keyboardType="decimal-pad"
                    align="right"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t("Weight")}
                    value={draft.coefficient}
                    onChangeText={(next) => patch({ coefficient: next })}
                    keyboardType="decimal-pad"
                    align="right"
                  />
                </View>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: space.xs,
                }}
              >
                <Label>{t("Rolls up to")}</Label>
                <Text style={[type.heading, { color: palette.text }]}>
                  {value === null || outOf === null
                    ? "—"
                    : `${value.toFixed(2)} / ${outOf}`}
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1.2 }}>
                  <TextField
                    label={t("Result")}
                    value={draft.value}
                    onChangeText={(next) => patch({ value: next })}
                    keyboardType="decimal-pad"
                    align="right"
                    error={touched ? (problems.value ?? undefined) : undefined}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t("Out of")}
                    value={draft.outOf}
                    onChangeText={(next) => patch({ outOf: next })}
                    keyboardType="decimal-pad"
                    align="right"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={t("Weight")}
                    value={draft.coefficient}
                    onChangeText={(next) => patch({ coefficient: next })}
                    keyboardType="decimal-pad"
                    align="right"
                  />
                </View>
              </View>

              <Pressable
                onPress={addComponent}
                style={{ paddingVertical: space.xs }}
              >
                <Text style={[type.footnote, { color: palette.textMuted }]}>
                  {t("This grade is made of several parts")}
                </Text>
              </Pressable>
            </>
          )}

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
            label={t("Note")}
            value={draft.note}
            onChangeText={(note) => patch({ note })}
            placeholder={t("Careless mistakes, missed the last question…")}
            multiline
          />
        </FieldGroup>

        {preview ? (
          <Card>
            <View style={{ gap: space.md }}>
              <Label>{t("If you save this")}</Label>

              <PreviewRow
                label={t("general average")}
                before={preview.general.before}
                after={preview.general.after}
              />
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

        {error ? (
          <Text style={[type.footnote, { color: palette.negative }]}>
            {error}
          </Text>
        ) : null}

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
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
    >
      <Text
        numberOfLines={1}
        style={[type.body, { flex: 1, color: palette.textMuted }]}
      >
        {label}
      </Text>
      <AverageValue ratio={before} size="callout" />
      <Ionicons name="arrow-forward" size={13} color={palette.textFaint} />
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
