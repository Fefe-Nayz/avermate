import { useEffect, useMemo, useState } from "react";
import { Alert, Text } from "react-native";
import * as Crypto from "expo-crypto";
import { ChoiceField, SwitchField, TextField } from "@/components/field";
import { parseNumber } from "@/components/format";
import { Button, Card, Note, Problem, Row, Section } from "@/components/ui";
import { t } from "@/lib/i18n";
import { type, usePalette } from "@/lib/theme";
import {
  addPresetSubject,
  flattenPresetSubjects,
  parseManagedPresetConfiguration,
  presetConfigurationProblems,
  removePresetSubject,
  updatePresetSubject,
  type ManagedPresetAverage,
  type ManagedPresetConfiguration,
  type ManagedPresetSubject,
} from "./admin-preset-model";

function validKey(value: string): boolean {
  return /^[a-zA-Z0-9:._-]{1,128}$/.test(value);
}

function generatedKey(kind: "subject" | "average"): string {
  return `${kind}:${Crypto.randomUUID()}`;
}

export function PresetConfigurationEditor({
  value,
  onChange,
  technical = true,
}: {
  value: ManagedPresetConfiguration;
  onChange: (value: ManagedPresetConfiguration) => void;
  /** Admin screens expose stable identifiers and the raw configuration. */
  technical?: boolean;
}) {
  const palette = usePalette();
  const flat = useMemo(() => flattenPresetSubjects(value.subjects), [value]);
  const [selectedSubjectKey, setSelectedSubjectKey] = useState<string | null>(
    value.subjects[0]?.key ?? null,
  );
  const [selectedAverageKey, setSelectedAverageKey] = useState<string | null>(
    value.averages[0]?.key ?? null,
  );
  const [subjectKey, setSubjectKey] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectKind, setSubjectKind] = useState<"subject" | "category">(
    "subject",
  );
  const [parentKey, setParentKey] = useState<string | null>(null);
  const [averageKey, setAverageKey] = useState("");
  const [averageName, setAverageName] = useState("");
  const [averageSubjectKey, setAverageSubjectKey] = useState(
    flat[0]?.subject.key ?? "",
  );
  const [advanced, setAdvanced] = useState(false);
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!advanced) setRaw(JSON.stringify(value, null, 2));
  }, [advanced, value]);

  const selectedSubject = flat.find(
    ({ subject }) => subject.key === selectedSubjectKey,
  )?.subject;
  const selectedAverage = value.averages.find(
    (average) => average.key === selectedAverageKey,
  );
  const allKeys = new Set(flat.map(({ subject }) => subject.key));
  const problems = presetConfigurationProblems(value);

  const patchSubject = (
    patch: Partial<Omit<ManagedPresetSubject, "key" | "children">>,
  ) => {
    if (!selectedSubject) return;
    onChange({
      ...value,
      subjects: updatePresetSubject(
        value.subjects,
        selectedSubject.key,
        (subject) => ({ ...subject, ...patch }),
      ),
    });
  };

  const patchAverage = (patch: Partial<ManagedPresetAverage>) => {
    if (!selectedAverage) return;
    onChange({
      ...value,
      averages: value.averages.map((average) =>
        average.key === selectedAverage.key
          ? { ...average, ...patch, isMain: false }
          : average,
      ),
    });
  };

  const addSubject = () => {
    const key = technical ? subjectKey.trim() : generatedKey("subject");
    const name = subjectName.trim();
    if (!validKey(key) || !name || allKeys.has(key)) {
      setProblem(
        technical
          ? allKeys.has(key)
            ? t("That stable key is already used.")
            : t("Use a valid stable key and subject name.")
          : t("Give the subject a name."),
      );
      return;
    }
    const subject: ManagedPresetSubject = {
      key,
      name,
      kind: subjectKind,
      isMain: false,
      coefficient: 1,
      children: [],
    };
    onChange({
      ...value,
      subjects: addPresetSubject(value.subjects, parentKey, subject),
    });
    setSelectedSubjectKey(key);
    setSubjectKey("");
    setSubjectName("");
    setProblem(null);
  };

  const addAverage = () => {
    const key = technical ? averageKey.trim() : generatedKey("average");
    const name = averageName.trim();
    if (
      !validKey(key) ||
      !name ||
      !allKeys.has(averageSubjectKey) ||
      value.averages.some((average) => average.key === key)
    ) {
      setProblem(
        technical
          ? t("Use a unique stable key, a name and an initial subject.")
          : t("Choose a name and first subject."),
      );
      return;
    }
    const average: ManagedPresetAverage = {
      key,
      name,
      isMain: false,
      entries: [
        {
          subjectKey: averageSubjectKey,
          coefficient: null,
          includeChildren: false,
        },
      ],
    };
    onChange({ ...value, averages: [...value.averages, average] });
    setSelectedAverageKey(key);
    setAverageKey("");
    setAverageName("");
    setProblem(null);
  };

  return (
    <>
      <Section title={technical ? t("Subject tree") : t("Subjects")}>
        <Card padded={false}>
          {flat.map(({ subject, depth }, index) => (
            <Row
              key={subject.key}
              first={index === 0}
              indent={depth}
              title={subject.name}
              subtitle={
                technical
                  ? `${subject.key} · ${subject.kind}`
                  : subject.kind === "category"
                    ? t("Category")
                    : t("Subject")
              }
              onPress={() => setSelectedSubjectKey(subject.key)}
              trailing={
                <Text style={[type.footnote, { color: palette.textMuted }]}>
                  ×{subject.coefficient}
                </Text>
              }
            />
          ))}
        </Card>
      </Section>

      {selectedSubject ? (
        <Section title={t("Edit subject")}>
          {technical ? (
            <Note>
              {t("Stable key: {key}. Keep it unchanged across versions.", {
                key: selectedSubject.key,
              })}
            </Note>
          ) : null}
          <TextField
            label={t("Name")}
            value={selectedSubject.name}
            onChangeText={(name) => patchSubject({ name })}
          />
          <TextField
            label={t("Short name")}
            value={selectedSubject.shortName ?? ""}
            onChangeText={(shortName) =>
              patchSubject({ shortName: shortName || undefined })
            }
          />
          <TextField
            label={t("Coefficient")}
            value={String(selectedSubject.coefficient)}
            onChangeText={(text) => {
              const coefficient = parseNumber(text);
              if (coefficient !== null && coefficient >= 0) {
                patchSubject({ coefficient });
              }
            }}
            keyboardType="decimal-pad"
          />
          <ChoiceField
            label={t("Type")}
            value={selectedSubject.kind}
            onChange={(kind) => {
              if (kind === "subject" && selectedSubject.children.length > 0) {
                setProblem(
                  t(
                    "Remove or move child subjects before changing this category.",
                  ),
                );
                return;
              }
              patchSubject({ kind: kind as "subject" | "category" });
            }}
            choices={[
              { value: "subject", label: t("Subject") },
              { value: "category", label: t("Category") },
            ]}
          />
          <SwitchField
            label={t("Headline subject")}
            value={selectedSubject.isMain}
            onValueChange={(isMain) => patchSubject({ isMain })}
          />
          <Button
            label={t("Remove subject and descendants")}
            variant="destructive"
            disabled={
              value.subjects.length === 1 &&
              selectedSubjectKey === value.subjects[0]?.key
            }
            onPress={() =>
              Alert.alert(
                technical
                  ? t("Remove this preset subject?")
                  : t("Remove this subject?"),
                technical
                  ? t(
                      "Its descendants and matching average entries are removed from this draft.",
                    )
                  : t(
                      "Its child subjects and matching average entries will also be removed.",
                    ),
                [
                  { text: t("Cancel"), style: "cancel" },
                  {
                    text: t("Remove"),
                    style: "destructive",
                    onPress: () => {
                      onChange(removePresetSubject(value, selectedSubject.key));
                      setSelectedSubjectKey(null);
                    },
                  },
                ],
              )
            }
          />
        </Section>
      ) : null}

      <Section title={technical ? t("Add a subject node") : t("Add subject")}>
        {technical ? (
          <TextField
            label={t("Stable key")}
            value={subjectKey}
            onChangeText={setSubjectKey}
            autoCapitalize="none"
            placeholder="mathematics"
          />
        ) : null}
        <TextField
          label={t("Name")}
          value={subjectName}
          onChangeText={setSubjectName}
        />
        <ChoiceField
          label={t("Type")}
          value={subjectKind}
          onChange={(kind) => setSubjectKind(kind as typeof subjectKind)}
          choices={[
            { value: "subject", label: t("Subject") },
            { value: "category", label: t("Category") },
          ]}
        />
        <ChoiceField
          label={t("Parent category")}
          value={parentKey ?? ""}
          onChange={(key) => setParentKey(key || null)}
          choices={[
            { value: "", label: t("Top level") },
            ...flat
              .filter(({ subject }) => subject.kind === "category")
              .map(({ subject }) => ({
                value: subject.key,
                label: subject.name,
                hint: technical ? subject.key : undefined,
              })),
          ]}
        />
        <Button
          label={t("Add subject")}
          variant="secondary"
          disabled={(technical && !subjectKey.trim()) || !subjectName.trim()}
          onPress={addSubject}
        />
      </Section>

      <Section title={t("Custom averages")}>
        {value.averages.length > 0 ? (
          <Card padded={false}>
            {value.averages.map((average, index) => (
              <Row
                key={average.key}
                first={index === 0}
                title={average.name}
                subtitle={
                  technical
                    ? `${average.key} · ${average.entries.length} ${t("subjects")}`
                    : t("{count} subjects", {
                        count: average.entries.length,
                      })
                }
                onPress={() => setSelectedAverageKey(average.key)}
              />
            ))}
          </Card>
        ) : (
          <Note>
            {technical
              ? t("No custom averages in this preset.")
              : t("No custom averages yet.")}
          </Note>
        )}
      </Section>

      {selectedAverage ? (
        <Section title={t("Edit custom average")}>
          {technical ? (
            <Note>
              {t("Stable key: {key}. Keep it unchanged across versions.", {
                key: selectedAverage.key,
              })}
            </Note>
          ) : null}
          <TextField
            label={t("Name")}
            value={selectedAverage.name}
            onChangeText={(name) => patchAverage({ name })}
          />
          {flat.map(({ subject }) => {
            const entry = selectedAverage.entries.find(
              (item) => item.subjectKey === subject.key,
            );
            return (
              <Card key={subject.key} style={{ gap: 8 }}>
                <SwitchField
                  label={subject.name}
                  hint={technical ? subject.key : undefined}
                  value={Boolean(entry)}
                  onValueChange={(enabled) => {
                    const entries = enabled
                      ? [
                          ...selectedAverage.entries,
                          {
                            subjectKey: subject.key,
                            coefficient: null,
                            includeChildren: false,
                          },
                        ]
                      : selectedAverage.entries.filter(
                          (item) => item.subjectKey !== subject.key,
                        );
                    patchAverage({ entries });
                  }}
                />
                {entry ? (
                  <>
                    <TextField
                      label={t("Coefficient override (blank inherits)")}
                      value={
                        entry.coefficient === null
                          ? ""
                          : String(entry.coefficient)
                      }
                      onChangeText={(text) => {
                        const coefficient = text.trim()
                          ? parseNumber(text)
                          : null;
                        if (coefficient === null || coefficient >= 0) {
                          patchAverage({
                            entries: selectedAverage.entries.map((item) =>
                              item.subjectKey === subject.key
                                ? { ...item, coefficient }
                                : item,
                            ),
                          });
                        }
                      }}
                      keyboardType="decimal-pad"
                    />
                    <SwitchField
                      label={t("Include descendants")}
                      value={entry.includeChildren}
                      onValueChange={(includeChildren) =>
                        patchAverage({
                          entries: selectedAverage.entries.map((item) =>
                            item.subjectKey === subject.key
                              ? { ...item, includeChildren }
                              : item,
                          ),
                        })
                      }
                    />
                  </>
                ) : null}
              </Card>
            );
          })}
          <Button
            label={t("Remove custom average")}
            variant="destructive"
            onPress={() => {
              onChange({
                ...value,
                averages: value.averages.filter(
                  (average) => average.key !== selectedAverage.key,
                ),
              });
              setSelectedAverageKey(null);
            }}
          />
        </Section>
      ) : null}

      <Section title={t("Add a custom average")}>
        {technical ? (
          <TextField
            label={t("Stable key")}
            value={averageKey}
            onChangeText={setAverageKey}
            autoCapitalize="none"
            placeholder="scientific-average"
          />
        ) : null}
        <TextField
          label={t("Name")}
          value={averageName}
          onChangeText={setAverageName}
        />
        <ChoiceField
          label={t("First subject")}
          value={averageSubjectKey}
          onChange={setAverageSubjectKey}
          choices={flat.map(({ subject }) => ({
            value: subject.key,
            label: subject.name,
            hint: technical ? subject.key : undefined,
          }))}
        />
        <Button
          label={t("Add custom average")}
          variant="secondary"
          disabled={
            (technical && !averageKey.trim()) ||
            !averageName.trim() ||
            !averageSubjectKey
          }
          onPress={addAverage}
        />
      </Section>

      {problems.length > 0 ? (
        <Section
          title={technical ? t("Draft problems") : t("Check the configuration")}
        >
          <Problem>
            {technical
              ? problems.join("\n")
              : t(
                  "Every subject and custom average needs a valid name and coefficient.",
                )}
          </Problem>
        </Section>
      ) : null}
      {problem ? <Problem>{problem}</Problem> : null}

      {technical ? (
        <Section title={t("Advanced")}>
          <SwitchField
            label={t("Advanced JSON editor")}
            hint={t(
              "The structured editor is safer for stable keys and references.",
            )}
            value={advanced}
            onValueChange={setAdvanced}
          />
          {advanced ? (
            <>
              <TextField
                label={t("Raw configuration")}
                value={raw}
                onChangeText={setRaw}
                multiline
                autoCapitalize="none"
              />
              <Button
                label={t("Apply JSON draft")}
                variant="secondary"
                onPress={() => {
                  try {
                    const next = parseManagedPresetConfiguration(raw);
                    onChange(next);
                    setProblem(null);
                  } catch (error) {
                    setProblem(
                      error instanceof Error
                        ? error.message
                        : t("Invalid JSON configuration."),
                    );
                  }
                }}
              />
              <Note>
                {t(
                  "The server validates unique keys, hierarchy, coefficients and average references again before publishing.",
                )}
              </Note>
            </>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}
