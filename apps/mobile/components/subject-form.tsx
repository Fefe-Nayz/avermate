import { useMemo, useState, type ReactNode } from "react";
import { Spacer } from "@expo/ui";
import type { Subject } from "@avermate/core";
import { Button, Grouped, Section, Text } from "@/components/native";
import {
  ChoiceField,
  PickerField,
  SwitchField,
  TextField,
  type Choice,
} from "@/components/controls";
import { parseNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * A subject, or a category.
 *
 * The kind switch is the one idea in the app worth explaining in the interface,
 * so it is explained here rather than in a help page: a subject counts once
 * with its own weight, a category dissolves and its children are weighed
 * individually one level up. Getting that wrong quietly changes every average,
 * so the hint under each option is not decoration.
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

export function emptySubjectDraft(parentId?: string): SubjectDraft {
  return {
    name: "",
    shortName: "",
    kind: "subject",
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
  extra?: ReactNode;
}) {
  const { yearGraph } = useYear();
  const [touched, setTouched] = useState(false);

  const parents = useMemo<Choice[]>(() => {
    const banned = new Set<string>();
    if (excludeId) {
      banned.add(excludeId);
      for (const descendant of yearGraph.descendantsOf(excludeId)) {
        banned.add(descendant.id);
      }
    }

    const walk = (nodes: readonly Subject[], depth: number): Choice[] =>
      [...nodes]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .filter((subject) => !banned.has(subject.id))
        .flatMap((subject) => [
          { value: subject.id, label: subject.name, depth },
          ...walk(yearGraph.childrenOf(subject.id), depth + 1),
        ]);

    return [
      { value: "__root__", label: t("Top level") },
      ...walk(yearGraph.roots, 0),
    ];
  }, [yearGraph, excludeId]);

  const nameProblem =
    draft.name.trim().length === 0 ? t("Give this subject a name.") : null;

  const patch = (values: Partial<SubjectDraft>) =>
    onChange({ ...draft, ...values });

  const submit = () => {
    setTouched(true);
    if (nameProblem) {
      haptic("error");
      return;
    }
    onSubmit({
      name: draft.name.trim(),
      shortName: draft.shortName.trim() || null,
      kind: draft.kind,
      parentId: draft.parentId,
      coefficient: parseNumber(draft.coefficient) ?? 1,
      isMain: draft.isMain,
    });
  };

  return (
    <Grouped footer={<Button label={submitLabel} onPress={submit} disabled={busy} />}>
      <Section>
        <TextField
          label={t("Name")}
          value={draft.name}
          onChangeText={(name) => patch({ name })}
          placeholder={t("Mathematics, Philosophy…")}
          error={touched ? (nameProblem ?? undefined) : undefined}
          autoFocus
        />
        <TextField
          label={t("Short name")}
          value={draft.shortName}
          onChangeText={(shortName) => patch({ shortName })}
          placeholder={t("Used where space is tight")}
        />
      </Section>

      <ChoiceField
        title={t("How does it count?")}
        value={draft.kind}
        onChange={(kind) => patch({ kind: kind as SubjectDraft["kind"] })}
        choices={[
          {
            value: "subject",
            label: t("Subject"),
            hint: t("Counts once, with its own average and weight"),
          },
          {
            value: "category",
            label: t("Category"),
            hint: t("Just a grouping — its children are weighed one by one"),
          },
        ]}
      />

      <Section title={t("Where it sits")}>
        <PickerField
          label={t("Inside")}
          choices={parents}
          value={draft.parentId ?? "__root__"}
          onChange={(parentId) =>
            patch({ parentId: parentId === "__root__" ? null : parentId })
          }
        />
        {draft.kind === "subject" ? (
          <TextField
            label={t("Weight")}
            value={draft.coefficient}
            onChangeText={(coefficient) => patch({ coefficient })}
            keyboardType="decimal-pad"
          />
        ) : null}
        <SwitchField
          label={t("Show on the dashboard")}
          detail={t("Keeps this one in front of you all year.")}
          value={draft.isMain}
          onValueChange={(isMain) => patch({ isMain })}
        />
      </Section>

      {error ? (
        <Section>
          <Text size="footnote" tone="negative">
            {error}
          </Text>
        </Section>
      ) : null}

      {extra}
      <Spacer size={space.xl} />
    </Grouped>
  );
}
