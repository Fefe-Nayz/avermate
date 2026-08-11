import Constants from "expo-constants";
import type { SystemWidgetPayload } from "./system-widget-model";
import type { SystemWidgetRuntimeResult } from "./system-widget-runtime";

export async function updateSystemWidget(
  payload: SystemWidgetPayload,
): Promise<SystemWidgetRuntimeResult> {
  // Importing expo-widgets in Expo Go throws because the native extension
  // module is intentionally absent. Check first so Expo Go remains a supported
  // development path for every non-system feature.
  if (Constants.expoGoConfig) return "development-build-required";

  try {
    const { default: widget } = await import(
      "@/widgets/avermate-summary-widget"
    );
    widget.updateSnapshot(payload);
    return "updated";
  } catch {
    // A binary built before the config plugin was added is equivalent to Expo
    // Go for this feature and should never take down the rest of settings.
    return "development-build-required";
  }
}
