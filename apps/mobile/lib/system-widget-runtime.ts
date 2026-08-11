import type { SystemWidgetPayload } from "./system-widget-model";

export type SystemWidgetRuntimeResult =
  | "updated"
  | "unsupported"
  | "development-build-required";

/** Android/web keep full in-app widgets; Expo's supported extension is iOS. */
export async function updateSystemWidget(
  _payload: SystemWidgetPayload,
): Promise<SystemWidgetRuntimeResult> {
  return "unsupported";
}
