import { useMemo, useState } from "react";
import { Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  resolveSlotMapping,
  substituteSlots,
  templateSlots,
  WIDGET_DEFINITION_VERSION,
  type TemplateSlotKind,
  type WidgetDefinitionV1,
  type WidgetSurface,
} from "@avermate/core";
import { Button, Card, Empty, Loading, Screen, Section } from "@/components/ui";
import { PickerField } from "@/components/field";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";

/**
 * The card gallery, on the phone: the same published templates every account
 * sees on the web. A template's entity references are its "essential
 * options" — each becomes a picker pre-filled with the installer's first
 * matching entity, and installing writes a plain card through cards.create,
 * so a gallery card and a hand-built one are the same thing afterwards.
 */

interface TemplateRow {
  id: string;
  title: string;
  description: string;
  surfaces: string[];
  definitionJson: WidgetDefinitionV1;
}

type SlotOptions = Record<
  TemplateSlotKind,
  Array<{ value: string; label: string }>
>;

function widgetSurface(value: string | undefined): WidgetSurface {
  return value === "insights" ? "insights" : "overview";
}

const SLOT_LABELS: Record<TemplateSlotKind, () => string> = {
  subject: () => t("Subject"),
  "custom-average": () => t("Custom average"),
  goal: () => t("Goal"),
  period: () => t("Period"),
};

function GalleryItem({
  template,
  options,
  installing,
  disabled,
  onInstall,
}: {
  template: TemplateRow;
  options: SlotOptions;
  installing: boolean;
  disabled: boolean;
  onInstall: (definition: WidgetDefinitionV1) => void;
}) {
  const palette = usePalette();
  const [picks, setPicks] = useState<Record<string, string>>({});

  const slots = useMemo(
    () => templateSlots(template.definitionJson),
    [template.definitionJson],
  );
  const mapping = resolveSlotMapping(
    slots,
    options,
    new Map(Object.entries(picks)),
  );

  return (
    <Card style={{ gap: space.md }}>
      <Text selectable style={[type.heading, { color: palette.text }]}>
        {template.title}
      </Text>
      {template.description ? (
        <Text selectable style={[type.footnote, { color: palette.textMuted }]}>
          {template.description}
        </Text>
      ) : null}
      {slots.map((slot, index) => {
        const choices = options[slot.kind];
        return (
          <PickerField
            key={`${slot.placeholderId}:${index}`}
            label={SLOT_LABELS[slot.kind]()}
            choices={choices}
            value={mapping.get(slot.placeholderId) ?? null}
            onChange={(value) =>
              setPicks((current) => ({
                ...current,
                [slot.placeholderId]: value,
              }))
            }
            emptyHint={t("Nothing of this kind exists in this year yet.")}
          />
        );
      })}
      <Button
        label={t("Install")}
        icon="add-circle"
        loading={installing}
        disabled={disabled}
        onPress={() =>
          onInstall(substituteSlots(template.definitionJson, mapping))
        }
      />
    </Card>
  );
}

export default function CardGallery() {
  const router = useRouter();
  const params = useLocalSearchParams<{ surface?: string }>();
  const surface = widgetSurface(params.surface);
  const { yearId, graph, customAverages, goals, periods } = useYear();
  const templates = useQuery(orpc.cardTemplates.list.queryOptions());
  const [installingId, setInstallingId] = useState<string | null>(null);

  const install = useMutation({
    mutationFn: (definition: WidgetDefinitionV1) => {
      if (!yearId) throw new Error("No year selected");
      return client.cards.create({
        yearId,
        surface,
        span: surface === "insights" ? 4 : 2,
        title: null,
        accent: null,
        hidden: false,
        definitionVersion: WIDGET_DEFINITION_VERSION,
        definitionJson: definition,
      });
    },
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries({
        queryKey: orpc.cards.list.queryKey({
          input: { yearId: yearId ?? "", surface },
        }),
      });
      router.back();
    },
    onError: () => {
      haptic("error");
      setInstallingId(null);
    },
  });

  const options = useMemo<SlotOptions>(
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

  const rows = ((templates.data ?? []) as TemplateRow[]).filter((template) =>
    template.surfaces.includes(surface),
  );

  return (
    <>
      <Stack.Screen options={{ title: t("Card gallery") }} />
      <Screen>
        {templates.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Section>
            <Empty
              icon="sparkles-outline"
              title={t("No templates published yet.")}
              body={t("Curated cards will appear here once the catalog opens.")}
            />
          </Section>
        ) : (
          rows.map((template) => (
            <Section key={template.id}>
              <GalleryItem
                template={template}
                options={options}
                installing={install.isPending && installingId === template.id}
                disabled={install.isPending || !yearId}
                onInstall={(definition) => {
                  setInstallingId(template.id);
                  install.mutate(definition);
                }}
              />
            </Section>
          ))
        )}
      </Screen>
    </>
  );
}
