import { View } from "react-native";
import { Host, Slider, Switch } from "@expo/ui";
import { useIsDark, usePalette } from "@/lib/theme";

/**
 * The two controls that are worth handing to the platform.
 *
 * A switch and a slider are things people have muscle memory for — the exact
 * throw of the thumb, the way the track lights up, the little detent. Redrawing
 * them in JavaScript always lands slightly off. `@expo/ui` renders the real
 * SwiftUI and Jetpack Compose controls, so these two feel native because they
 * are. Everything else in the app is drawn by hand, where matching the design
 * matters more than matching the OS.
 *
 * Both need a `Host` bridge, and a `Host` has no intrinsic size — hence the
 * fixed heights.
 */

export function NativeSwitch({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const isDark = useIsDark();
  const palette = usePalette();

  return (
    <Host
      matchContents
      colorScheme={isDark ? "dark" : "light"}
      seedColor={palette.band.excellent}
      style={{ width: 56, height: 34 }}
    >
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </Host>
  );
}

export function NativeSlider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const isDark = useIsDark();
  const palette = usePalette();

  return (
    <View style={{ height: 40, justifyContent: "center" }}>
      <Host
        colorScheme={isDark ? "dark" : "light"}
        seedColor={palette.text}
        style={{ height: 40 }}
      >
        <Slider
          value={value}
          onValueChange={onValueChange}
          min={min}
          max={max}
          step={step}
        />
      </Host>
    </View>
  );
}
