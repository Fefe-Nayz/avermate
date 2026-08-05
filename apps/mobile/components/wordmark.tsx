import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { space, type, usePalette } from "@/lib/theme";

/**
 * The mark: a rising line inside a rounded square. It is the same idea as the
 * sparkline on the dashboard, which is the point — the app is about a number
 * going up, and the logo says so before any data loads.
 */
export function Wordmark({ size = 30 }: { size?: number }) {
  const palette = usePalette();

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: palette.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24">
          <Path
            d="M3 17 L9 11 L13 15 L21 6"
            stroke={palette.accentText}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </View>
      <Text
        style={[
          type.heading,
          { color: palette.text, letterSpacing: -0.3, fontSize: size * 0.6 },
        ]}
      >
        Avermate
      </Text>
    </View>
  );
}
