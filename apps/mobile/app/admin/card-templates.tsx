import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  WIDGET_DEFINITION_VERSION,
  estimateRemaining,
  evaluateWidgetDefinition,
  resolveSlotMapping,
  substituteSlots,
  templateSlots,
  type TemplateSlotKind,
  type WidgetDefinitionV1,
  type WidgetEvaluationContext,
  type WidgetEvaluationResult,
  type WidgetSurface,
} from "@avermate/core";
import {
  Badge,
  Button,
  Card,
  Confirmation,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { PickerField, TextField } from "@/components/field";
import { AdminGate } from "@/components/admin/admin-gate";
import { useCards } from "@/components/use-cards";
import { useYear } from "@/components/year-provider";
import {
  WidgetResultRenderer,
  widgetCardTitle,
} from "@/components/widgets/widget-renderer";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";
import { timelineCutoffTimestamp } from "@/lib/timeline";

/**
 * Curating the card gallery, on the phone: the admin side of
 * `settings/card-gallery`. Lift one of your own cards as a draft, edit its
 * metadata, publish or archive it — and see every template as the live card
 * it will be, evaluated on your own data with each slot filled by your first
 * matching entity, exactly as the web admin surface does.
 */

interface TemplateRow {
  id: string;
  title: string;
  description: string;
  surfaces: string[];
  category: string;
  status: "draft" | "published" | "archived";
  definitionVersion: number;
  definitionJson: WidgetDefinitionV1;
}

type SlotOptions = Record<
  TemplateSlotKind,
  Array<{ value: string; label: string }>
>;

const STATUS_LABELS: Record<TemplateRow["status"], () => string> = {
  draft: () => t("Draft"),
  published: () => t("Published"),
  archived: () => t("Archived"),
};

/**
 * The web admin previews each template through `useWidgetResult`; this is the
 * same evaluation for one definition, with the context built exactly the way
 * `useCards` builds it for stored cards.
 */
function useTemplatePreview(
  definition: WidgetDefinitionV1,
  surface: WidgetSurface,
): WidgetEvaluationResult | undefined {
  const yearState = useYear();

  return useMemo(() => {
    const { year, period } = yearState;
    if (!year) return undefined;

    const cutoff =
      timelineCutoffTimestamp(yearState.timelineDate) ?? yearState.now;
    const from = period.startAt;
    const boundedTo = new Date(Math.min(cutoff, period.endAt.getTime()));
    const to = boundedTo > from ? boundedTo : new Date(from.getTime() + 1);
    const context: WidgetEvaluationContext = {
      surface,
      graph: yearState.graph,
      subjects: yearState.graph.subjects,
      yearSubjects: yearState.yearGraph.subjects,
      scope: null,
      from,
      to,
      passingRatio: yearState.passingRatio,
      goals: yearState.goals,
      periods: yearState.periods,
      customAverages: yearState.customAverages,
      year: {
        startsAt: year.startsAt,
        endsAt: year.endsAt,
        scale: year.scale,
      },
      now: new Date(cutoff),
      remaining: estimateRemaining(yearState.graph, from, period.endAt),
      resolveTarget: (target) => {
        const resolved = yearState.resolve(target);
        if (!resolved) return null;
        return {
          graph: resolved.graph,
          subjects: resolved.graph.subjects,
          scope: resolved.scope,
          subjectId: resolved.subjectId,
        };
      },
    };
    return evaluateWidgetDefinition(definition, context);
  }, [definition, surface, yearState]);
}

function AdminTemplateCard({
  template,
  onChanged,
}: {
  template: TemplateRow;
  onChanged: () => void;
}) {
  const palette = usePalette();
  const { graph, customAverages, goals, periods } = useYear();
  const [title, setTitle] = useState(template.title);
  const [description, setDescription] = useState(template.description);
  const [category, setCategory] = useState(template.category);
  const [problem, setProblem] = useState<string | null>(null);

  const onError = (error: Error) => {
    haptic("error");
    setProblem(error.message || t("That could not be saved."));
  };

  const publish = useMutation({
    ...orpc.cardTemplates.publish.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      setProblem(null);
      onChanged();
    },
    onError,
  });
  const archive = useMutation({
    ...orpc.cardTemplates.archive.mutationOptions(),
    onSuccess: () => {
      haptic("light");
      setProblem(null);
      onChanged();
    },
    onError,
  });
  const update = useMutation({
    ...orpc.cardTemplates.update.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      setProblem(null);
      onChanged();
    },
    onError,
  });

  const slotOptions = useMemo<SlotOptions>(
    () => ({
      subject: graph
        .flatten()
        .map((subject) => ({ value: subject.id, label: subject.name })),
      "custom-average": customAverages.map((average) => ({
        value: average.id,
        label: average.name,
      })),
      goal: goals.map((goal) => ({ value: goal.id, label: goal.name })),
      period: periods.map((period) => ({
        value: period.id,
        label: period.name,
      })),
    }),
    [customAverages, goals, graph, periods],
  );

  const slots = useMemo(
    () => templateSlots(template.definitionJson),
    [template.definitionJson],
  );
  const previewDefinition = useMemo(
    () =>
      substituteSlots(
        template.definitionJson,
        resolveSlotMapping(slots, slotOptions),
      ),
    [slotOptions, slots, template.definitionJson],
  );
  const surface = (template.surfaces[0] ?? "overview") as WidgetSurface;
  const result = useTemplatePreview(previewDefinition, surface);

  const draft = template.status === "draft";
  const metadataDirty =
    title !== template.title ||
    description !== template.description ||
    category !== template.category;

  return (
    <Card style={{ gap: space.md }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
        }}
      >
        <Text
          numberOfLines={2}
          style={[type.label, { flexShrink: 1, color: palette.textFaint }]}
        >
          {template.title}
        </Text>
        <Badge
          label={STATUS_LABELS[template.status]()}
          toneColor={template.status === "published" ? "accent" : "neutral"}
        />
      </View>
      <View style={{ minHeight: 96 }}>
        <WidgetResultRenderer definition={previewDefinition} result={result} />
      </View>
      <Text style={[type.footnote, { color: palette.textMuted }]}>
        {`${template.category} · ${template.surfaces.join(", ")}${
          slots.length > 0
            ? ` · ${t("{count} installer choices", { count: slots.length })}`
            : ""
        }`}
      </Text>
      {draft ? (
        <>
          <TextField
            label={t("Title")}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
          <TextField
            label={t("Description")}
            value={description}
            onChangeText={setDescription}
            placeholder={t("Description")}
            maxLength={280}
          />
          <TextField
            label={t("Category")}
            value={category}
            onChangeText={setCategory}
            maxLength={48}
          />
        </>
      ) : null}
      {template.status !== "archived" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {draft && metadataDirty ? (
            <Button
              size="sm"
              label={t("Save")}
              loading={update.isPending}
              disabled={update.isPending || title.trim().length === 0}
              onPress={() =>
                update.mutate({
                  templateId: template.id,
                  title: title.trim(),
                  description: description.trim(),
                  category: category.trim() || "general",
                })
              }
            />
          ) : null}
          {draft ? (
            <Button
              size="sm"
              variant="outline"
              label={t("Publish")}
              loading={publish.isPending}
              disabled={publish.isPending}
              onPress={() => publish.mutate({ templateId: template.id })}
            />
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            tone="light"
            label={t("Archive")}
            loading={archive.isPending}
            disabled={archive.isPending}
            onPress={() => archive.mutate({ templateId: template.id })}
          />
        </View>
      ) : null}
      {problem ? <Problem>{problem}</Problem> : null}
    </Card>
  );
}

export default function AdminCardTemplates() {
  const overview = useCards("overview");
  const insights = useCards("insights");
  const [sourceCardId, setSourceCardId] = useState("");
  const templates = useQuery(orpc.cardTemplates.adminList.queryOptions());

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.cardTemplates.adminList.key(),
    });
    void queryClient.invalidateQueries({
      queryKey: orpc.cardTemplates.list.key(),
    });
  };

  const create = useMutation({
    ...orpc.cardTemplates.create.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      setSourceCardId("");
      refresh();
    },
    onError: () => haptic("error"),
  });

  // The web picks from every visible card the admin owns; here that is the
  // dashboard and the insights surface, resolved the same dual-read way.
  const sources = useMemo(
    () => [...overview.cards, ...insights.cards],
    [insights.cards, overview.cards],
  );

  const createFromCard = () => {
    const card = sources.find((item) => item.id === sourceCardId);
    if (!card) return;
    create.mutate({
      title: card.title?.trim() || t("Untitled card"),
      description: "",
      surfaces: [card.surface],
      category: "general",
      definitionVersion: WIDGET_DEFINITION_VERSION,
      definitionJson: card.definition as unknown as Record<string, unknown>,
      sortOrder: 0,
    });
  };

  const rows = (templates.data ?? []) as TemplateRow[];

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Card gallery") }} />
      <Screen>
        <Section>
          <Note>
            {t(
              "Curated card templates every account can browse and install. Lift one of your existing cards — references to your entities become the installer's choices.",
            )}
          </Note>
          <PickerField
            label={t("Card")}
            placeholder={t("Pick one of your cards…")}
            choices={sources.map((card) => ({
              value: card.id,
              label:
                (card.title?.trim() || widgetCardTitle(card)) +
                (card.surface === "insights" ? ` · ${t("Insights")}` : ""),
            }))}
            value={sourceCardId || null}
            onChange={setSourceCardId}
            emptyHint={t("Nothing of this kind exists in this year yet.")}
          />
          <Button
            label={t("Create a draft from it")}
            icon="add-circle"
            loading={create.isPending}
            disabled={!sourceCardId || create.isPending}
            onPress={createFromCard}
          />
          {create.isSuccess && !sourceCardId ? (
            <Confirmation>{t("Draft created")}</Confirmation>
          ) : null}
          {create.error instanceof Error ? (
            <Problem>
              {create.error.message || t("That could not be saved.")}
            </Problem>
          ) : null}
        </Section>

        {templates.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Section>
            <Empty
              icon="albums-outline"
              title={t("No templates yet.")}
              body={t("Create the first draft from one of your cards.")}
            />
          </Section>
        ) : (
          rows.map((template) => (
            <Section key={template.id}>
              <AdminTemplateCard template={template} onChanged={refresh} />
            </Section>
          ))
        )}
      </Screen>
    </AdminGate>
  );
}
