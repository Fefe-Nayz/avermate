import type { WidgetFlowOption, WidgetOptionProvider } from "@avermate/core";

export type WidgetOptionSets = Partial<
  Record<WidgetOptionProvider, WidgetFlowOption[]>
>;

interface OptionField {
  options?: WidgetFlowOption[];
  optionProvider?: WidgetOptionProvider;
}

/** Resolved flow options win so capability/channel filtering cannot be bypassed. */
export function widgetFieldOptions(
  field: OptionField,
  optionSets: WidgetOptionSets | undefined,
): WidgetFlowOption[] {
  if (field.options !== undefined) return field.options;
  if (field.optionProvider) return optionSets?.[field.optionProvider] ?? [];
  return [];
}
