import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Haptic feedback, mapped onto the real Taptic Engine rather than the web's
 * blunt vibrate(). Silently inert on hardware that has none.
 */
export type Tone =
  "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error";

let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function hapticsEnabled(): boolean {
  return enabled;
}

export function haptic(tone: Tone = "medium"): void {
  if (!enabled || Platform.OS === "web") return;

  switch (tone) {
    case "selection":
      void Haptics.selectionAsync();
      return;
    case "light":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    case "medium":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case "heavy":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    case "success":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case "warning":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    case "error":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
  }
}
