import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * A bottom sheet, matching the web's ResponsiveSheet on a phone.
 *
 * The rule the web draws applies here too: choices can live in a sheet,
 * input never does. So this carries a grab handle, a title, an optional
 * description and a list of choices — nothing that needs a keyboard.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityLabel={title}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
      />
      <View
        style={{
          backgroundColor: palette.surfaceRaised,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          borderCurve: "continuous",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          paddingBottom: insets.bottom + space.md,
        }}
      >
        <View style={{ alignItems: "center", paddingTop: space.sm }}>
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: palette.hairline,
            }}
          />
        </View>
        <View
          style={{ gap: 2, paddingHorizontal: space.lg, paddingTop: space.md }}
        >
          <Text style={[type.heading, { color: palette.text }]}>{title}</Text>
          {description ? (
            <Text style={[type.footnote, { color: palette.textMuted }]}>
              {description}
            </Text>
          ) : null}
        </View>
        <ScrollView
          style={{ maxHeight: 460 }}
          contentContainerStyle={{
            padding: space.sm,
            paddingHorizontal: space.md,
          }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}
