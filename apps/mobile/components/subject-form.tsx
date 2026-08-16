import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Button, Note, Problem, Screen } from "@/components/ui";
import {
  ChoiceField,
  FieldGroup,
  PickerField,
  TextField,
  SwitchField,
  type Choice,
} from "@/components/field";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";
import type { Subject } from "@avermate/core";

/**
 * A subject, or a category.
 *
 * The kind switch is the one idea in the app worth explaining in the interface,
 * so it is explained here rather than in a help page: a subject counts once
 * with its own weight, a category dissolves and its children are weighed
 * individually one level up. Getting that wrong quietly changes every average,
 * so the hint under each option is not decoration.
 *
 * Field order, copy and validation follow the web `SubjectForm` step for step:
 * name and short name, where it sits, then how it counts.
 */

export interface SubjectDraft {
  name: string;
  shortName: string;
  kind: "subject" | "category";
  parentId: string | null;
  coefficient: string;
  isMain: boolean;
}

export interface SubjectPayload {
  name: string;
  shortName: string | null;
  kind: "subject" | "category";
  parentId: string | null;
  coefficient: number;
  isMain: boolean;
}

export function emptySubjectDraft(
  parentId?: string,
  kind: "subject" | "category" = "subject",
): SubjectDraft {
  return {
    name: "",
    shortName: "",
    kind,
    parentId: parentId ?? null,
    coefficient: "1",
    isMain: false,
  };
}

export function subjectDraftOf(subject: Subject): SubjectDraft {
  return {
    name: subject.name,
    shortName: subject.shortName ?? "",
    kind: subject.kind,
    parentId: subject.parentId,
    coefficient: String(subject.coefficient),
    isMain: subject.isMain,
  };
}

export function SubjectForm({
  draft,
  onChange,
  onSubmit,
  submitLabel,
  busy,
  error,
  excludeId,
  extra,
}: {
  draft: SubjectDraft;
  onChange: (draft: SubjectDraft) => void;
  onSubmit: (payload: SubjectPayload) => void;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  /** A subject cannot be moved inside itself or its own descendants. */
  excludeId?: string;
  extra?: React.ReactNode;
}) {
  const { yearGraph } = useYear();
  const [touched, setTouched] = useState(false);

  // A subject cannot sit inside itself, and neither can it sit inside one of
  // its own descendants — that branch would detach from the year.
  const parents = useMemo<Choice[]>(() => {
    const banned = new Set<string>();
    if (excludeId) {
      banned.add(excludeId);
      for (const descendant of yearGraph.descendantsOf(excludeId)) {
        banned.add(descendant.id);
      }
    }

    return [
      { value: "__root__", label: t("Top level") },
      ...yearGraph
        .flatten()
        .filter((subject) => !banned.has(subject.id))
        .map((subject) => ({
          value: subject.id,
          label: subject.name,
          depth: yearGraph.depthOf(subject.id) + 1,
          hint: subject.kind === "category" ? t("group") : undefined,
        })),
    ];
  }, [yearGraph, excludeId]);

  const nameProblem =
    draft.name.trim().length === 0 ? t("Give this subject a name.") : null;

  const patch = (values: Partial<SubjectDraft>) =>
    onChange({ ...draft, ...values });

  const submit = () => {
    setTouched(true);
    if (nameProblem) {
      haptic("warning");
      return;
    }
    onSubmit({
      name: draft.name.trim(),
      shortName: draft.shortName.trim() || null,
      kind: draft.kind,
      parentId: draft.parentId,
      coefficient: Number.parseFloat(draft.coefficient.replace(",", ".")) || 1,
      isMain: draft.isMain,
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <Screen
        footer={<Button label={submitLabel} onPress={submit} loading={busy} />}
      >
        <FieldGroup>
          <TextField
            label={t("Name")}
            value={draft.name}
            onChangeText={(name) => patch({ name })}
            placeholder={t("Mathematics, Physics, Written exam…")}
            error={touched ? (nameProblem ?? undefined) : undefined}
            autoFocus
          />

          <View style={{ gap: space.sm }}>
            <TextField
              label={t("Short name")}
              value={draft.shortName}
              onChangeText={(shortName) => patch({ shortName })}
              placeholder={t("Maths")}
              maxLength={24}
            />
            <Note>{t("Used on charts and narrow screens. Optional.")}</Note>
          </View>

          <PickerField
            label={t("Sits inside")}
            choices={parents}
            value={draft.parentId ?? "__root__"}
            onChange={(parentId) =>
              patch({ parentId: parentId === "__root__" ? null : parentId })
            }
            placeholder={t("Top level")}
          />

          <ChoiceField
            label={t("How does it count?")}
            value={draft.kind}
            onChange={(kind) => patch({ kind: kind as SubjectDraft["kind"] })}
            choices={[
              {
                value: "subject",
                label: t("Subject"),
                hint: t(
                  "Counted once, with its own weight, using its own average.",
                ),
              },
              {
                value: "category",
                label: t("Category"),
                hint: t(
                  "A heading. What it contains is weighed one by one at the level above.",
                ),
              },
            ]}
          />

          {draft.kind === "subject" ? (
            <View style={{ gap: space.sm }}>
              <TextField
                label={t("Weight")}
                value={draft.coefficient}
                onChangeText={(coefficient) => patch({ coefficient })}
                keyboardType="decimal-pad"
                align="right"
              />
              <Note>
                {t("How much this subject counts against its siblings.")}
              </Note>
            </View>
          ) : (
            <Note>
              {t("A category carries no weight of its own — its contents do.")}
            </Note>
          )}

          <SwitchField
            label={t("Show on the dashboard")}
            hint={t("Pinned to the sidebar and the home screen")}
            value={draft.isMain}
            onValueChange={(isMain) => {
              haptic("selection");
              patch({ isMain });
            }}
          />
        </FieldGroup>

        {error ? <Problem>{error}</Problem> : null}

        {extra}
      </Screen>
    </KeyboardAvoidingView>
  );
}
