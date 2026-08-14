import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  resolveWidgetFlow,
  widgetCapability,
  widgetMeasureId,
  type WidgetDefinitionV1,
  type WidgetFlowEditor as WidgetEditorKind,
  type WidgetSurface,
} from "@avermate/core";
import { FieldGroup } from "@/components/field";
import { Section } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { radius, space, type, usePalette } from "@/lib/theme";
import { WidgetFieldRenderer } from "./widget-field-renderer";
import { widgetMessage } from "./widget-messages";
import { useWidgetFlowContext } from "./use-widget-options";
import type { WidgetDraftValue } from "./widget-draft";
import {
  preservesRawWidgetDraft,
  resolveWidgetEditorChange,
} from "./widget-editor-model";

export function WidgetEditorTabs({
  value,
  onChange,
}: {
  value: WidgetEditorKind;
  onChange: (value: WidgetEditorKind) => void;
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        padding: 3,
        height: 46,
        borderRadius: radius.md,
        backgroundColor: palette.accentSoft,
      }}
    >
      {(
        [
          ["definition", "Definition"],
          ["visualization", "Chart"],
        ] as const
      ).map(([id, label]) => {
        const selected = value === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              haptic("selection");
              onChange(id);
            }}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              backgroundColor: selected ? palette.surface : "transparent",
            }}
          >
            <Text
              style={[
                type.callout,
                {
                  color: selected ? palette.text : palette.textMuted,
                  fontWeight: "600",
                },
              ]}
            >
              {widgetMessage(`widget.editor.${id}`) === id
                ? label
                : widgetMessage(`widget.editor.${id}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Complete core-driven definition and visualization editor. */
export function WidgetFlowEditor({
  definition,
  surface,
  editor: controlledEditor,
  onEditorChange,
  onChange,
}: {
  definition: WidgetDefinitionV1;
  surface: WidgetSurface;
  editor?: WidgetEditorKind;
  onEditorChange?: (editor: WidgetEditorKind) => void;
  onChange: (definition: WidgetDefinitionV1) => void;
}) {
  const [localEditor, setLocalEditor] =
    useState<WidgetEditorKind>("definition");
  const context = useWidgetFlowContext(surface);
  const flow = useMemo(
    () => resolveWidgetFlow(definition, context),
    [context, definition],
  );
  const editor = controlledEditor ?? localEditor;
  const sections = flow[editor];
  const canonicalDefinition = flow.prunedDefinition;
  const preserveRawDraft = useMemo(
    () => preservesRawWidgetDraft(definition, surface),
    [definition, surface],
  );
  const capability = widgetCapability(
    widgetMeasureId(canonicalDefinition.analysis.measure),
  );
  const selectEditor = (next: WidgetEditorKind) => {
    if (onEditorChange) onEditorChange(next);
    else setLocalEditor(next);
  };
  const commit = (draft: WidgetDraftValue) => {
    const raw = draft as unknown as WidgetDefinitionV1;
    onChange(resolveWidgetEditorChange(raw, context));
  };

  return (
    <View style={{ gap: space.xl }}>
      <WidgetEditorTabs value={editor} onChange={selectEditor} />
      {sections.map((section) => (
        <Section
          key={`${section.editor}:${section.id}`}
          title={widgetMessage(section.messageKey)}
          description={
            section.descriptionKey
              ? widgetMessage(section.descriptionKey) || undefined
              : undefined
          }
        >
          <FieldGroup>
            {section.fields
              .filter((field) => field.active)
              .map((field) => (
                <WidgetFieldRenderer
                  key={field.id}
                  field={field}
                  draft={
                    (preserveRawDraft
                      ? definition
                      : canonicalDefinition) as unknown as WidgetDraftValue
                  }
                  capability={capability}
                  optionSets={context.options}
                  onChange={commit}
                />
              ))}
          </FieldGroup>
        </Section>
      ))}
    </View>
  );
}
