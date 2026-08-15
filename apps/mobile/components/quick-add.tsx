import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon, type IconName } from "@/components/icon";
import { Sheet } from "@/components/sheet";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * The "+" action, the same one the web puts at the centre of its phone tab
 * bar: a sheet of choices, not a form. Picking what to create is one tap,
 * and every option then opens a full screen of its own.
 */

interface QuickAddStore {
  open: () => void;
  close: () => void;
}

const QuickAddContext = createContext<QuickAddStore | null>(null);

interface Action {
  href: string;
  label: string;
  hint: string;
  icon: IconName;
  accent?: boolean;
}

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const store = useMemo<QuickAddStore>(
    () => ({ open: () => setOpen(true), close: () => setOpen(false) }),
    [],
  );

  const actions: Action[] = [
    {
      href: "/grade/new",
      label: t("Grade"),
      hint: t("Record a result you were given"),
      icon: "add-circle",
      accent: true,
    },
    {
      href: "/subject/new",
      label: t("Subject"),
      hint: t("Add a course to this year"),
      icon: "book-marked",
    },
    {
      href: "/subject/new?kind=category",
      label: t("Category"),
      hint: t("Group subjects without adding a level of averaging"),
      icon: "folder-plus",
    },
    {
      href: "/goal/new",
      label: t("Goal"),
      hint: t("Set a target and get a way to reach it"),
      icon: "target",
    },
    {
      href: "/settings/average-edit",
      label: t("Custom average"),
      hint: t("Combine a few subjects into their own average"),
      icon: "sigma",
    },
    {
      href: "/settings/periods",
      label: t("Period"),
      hint: t("Split the year into trimesters or semesters"),
      icon: "calendar-range",
    },
  ];

  return (
    <QuickAddContext.Provider value={store}>
      {children}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("What are you adding?")}
        description={t("Everything here opens as its own screen.")}
      >
        {actions.map((action) => (
          <Pressable
            key={action.href}
            onPress={() => {
              haptic("light");
              setOpen(false);
              router.push(action.href as never);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.sm,
              paddingVertical: space.md,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: pressed ? palette.accentSoft : "transparent",
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                borderCurve: "continuous",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: action.accent
                  ? palette.accent
                  : palette.accentSoft,
              }}
            >
              <Icon
                name={action.icon}
                size={20}
                color={action.accent ? palette.accentText : palette.textMuted}
              />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text
                style={[type.body, { color: palette.text, fontWeight: "500" }]}
              >
                {action.label}
              </Text>
              <Text
                numberOfLines={1}
                style={[type.footnote, { color: palette.textMuted }]}
              >
                {action.hint}
              </Text>
            </View>
          </Pressable>
        ))}
      </Sheet>
    </QuickAddContext.Provider>
  );
}

export function useQuickAdd(): QuickAddStore {
  return (
    useContext(QuickAddContext) ?? {
      open: () => undefined,
      close: () => undefined,
    }
  );
}
