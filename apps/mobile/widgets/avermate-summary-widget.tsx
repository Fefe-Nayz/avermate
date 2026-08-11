import { HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  privacySensitive,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { SystemWidgetPayload } from "@/lib/system-widget-model";

/**
 * Pure WidgetKit layout. The only mutable input is the allow-listed aggregate
 * payload written by the app; it cannot read the network, auth state or social
 * cache from the extension process.
 */
function AvermateSummaryLayout(
  props: SystemWidgetPayload,
  environment: WidgetEnvironment,
) {
  "widget";

  const dark = environment.colorScheme === "dark";
  const primary = dark ? "#F7F7F2" : "#171713";
  const secondary = dark ? "#B9B9B0" : "#67675F";
  const background = dark ? "#171714" : "#FAFAF5";
  const accent = "#75A06F";
  const compact = environment.widgetFamily === "systemSmall";
  const academicModifiers = props.containsAcademicData
    ? [privacySensitive()]
    : [];

  return (
    <VStack
      alignment="leading"
      spacing={compact ? 5 : 7}
      modifiers={[
        frame({ maxWidth: 1000, maxHeight: 1000, alignment: "topLeading" }),
        padding({ all: compact ? 13 : 16 }),
        containerBackground(background, "widget"),
        widgetURL("avermate://"),
      ]}
    >
      <HStack spacing={6}>
        <Text
          modifiers={[
            font({ size: 12, weight: "semibold", design: "rounded" }),
            foregroundStyle(accent),
          ]}
        >
          {props.eyebrow || "Avermate"}
        </Text>
        <Spacer />
        {!compact && props.updatedLabel ? (
          <Text
            modifiers={[
              font({ size: 10, weight: "medium" }),
              foregroundStyle(secondary),
            ]}
          >
            {props.updatedLabel}
          </Text>
        ) : null}
      </HStack>

      <Spacer />

      <Text
        modifiers={[
          font({ size: props.state === "ready" ? (compact ? 26 : 30) : 15, weight: "bold", design: "rounded" }),
          foregroundStyle(primary),
          monospacedDigit(),
          lineLimit(props.state === "ready" ? 1 : 3),
          multilineTextAlignment("leading"),
          ...academicModifiers,
        ]}
      >
        {props.primary || "Avermate"}
      </Text>
      {props.primaryLabel ? (
        <Text
          modifiers={[
            font({ size: 11, weight: "medium" }),
            foregroundStyle(secondary),
            lineLimit(1),
            ...academicModifiers,
          ]}
        >
          {props.primaryLabel}
        </Text>
      ) : null}

      {!compact && props.secondary ? (
        <HStack spacing={6} modifiers={academicModifiers}>
          <Text
            modifiers={[
              font({ size: 14, weight: "semibold", design: "rounded" }),
              foregroundStyle(primary),
              monospacedDigit(),
            ]}
          >
            {props.secondary}
          </Text>
          <Text
            modifiers={[
              font({ size: 11, weight: "medium" }),
              foregroundStyle(secondary),
              lineLimit(1),
            ]}
          >
            {props.secondaryLabel}
          </Text>
        </HStack>
      ) : null}
    </VStack>
  );
}

export default createWidget<SystemWidgetPayload>(
  "AvermateSummaryWidget",
  AvermateSummaryLayout,
);
