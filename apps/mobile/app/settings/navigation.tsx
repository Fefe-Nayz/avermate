import { useState } from "react";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import {
  Button,
  Card,
  Confirmation,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import {
  NAV_TAB_ENTRIES,
  sanitizeTabSelection,
  setNavigationSettings,
  TAB_SLOT_COUNT,
} from "@/lib/navigation-settings";
import { client, orpc, queryClient } from "@/lib/orpc";
import { usePalette } from "@/lib/theme";

/**
 * The same choice the web offers under Settings → Navigation: which three
 * destinations sit on the tab bar. Order is the order of picking, everything
 * unpicked stays reachable behind "More", and the preference is shared with
 * the web so both shells rearrange together.
 */
export default function NavigationSettings() {
  const palette = usePalette();
  const preferences = useQuery(orpc.preferences.get.queryOptions());
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const stored = sanitizeTabSelection(preferences.data?.navigation?.tabs);
  const tabs = draft ?? stored;

  const update = useMutation({
    mutationFn: (nextTabs: string[]) =>
      client.preferences.update({
        navigation: { ...preferences.data?.navigation, tabs: nextTabs },
      }),
    onSuccess: (_result, nextTabs) => {
      haptic("success");
      setSaved(true);
      setNavigationSettings({ tabs: nextTabs });
      void queryClient.invalidateQueries({
        queryKey: orpc.preferences.get.queryKey(),
      });
    },
  });

  const toggle = (href: string) => {
    haptic("selection");
    setSaved(false);
    setDraft((current) => {
      const base = current ?? stored;
      if (base.includes(href)) {
        // Never below one: an empty tab bar is not a configuration.
        if (base.length === 1) return base;
        return base.filter((item) => item !== href);
      }
      if (base.length >= TAB_SLOT_COUNT) return base;
      return [...base, href];
    });
  };

  const dirty = draft !== null && draft.join("|") !== stored.join("|");
  const complete = tabs.length === TAB_SLOT_COUNT;

  return (
    <>
      <Stack.Screen options={{ title: t("Navigation") }} />
      <Screen
        footer={
          <Button
            label={t("Save")}
            disabled={!dirty || !complete || update.isPending}
            loading={update.isPending}
            onPress={() => update.mutate(sanitizeTabSelection(draft ?? stored))}
          />
        }
      >
        <Section
          title={t("Tab bar")}
          description={t(
            "Pick three. The order you pick is the order they sit in; the rest waits behind More.",
          )}
        >
          <Card padded={false}>
            {NAV_TAB_ENTRIES.map((entry, index) => {
              const position = tabs.indexOf(entry.href);
              const picked = position >= 0;
              return (
                <Row
                  key={entry.href}
                  first={index === 0}
                  leading={
                    <Icon
                      name={entry.icon}
                      size={20}
                      color={picked ? palette.text : palette.textFaint}
                    />
                  }
                  title={t(entry.label)}
                  trailing={
                    picked ? (
                      <Icon
                        name="checkmark-circle"
                        size={20}
                        color={palette.accent}
                      />
                    ) : undefined
                  }
                  onPress={() => toggle(entry.href)}
                />
              );
            })}
          </Card>
          <Note>
            {t("{count} of {total} picked", {
              count: String(tabs.length),
              total: String(TAB_SLOT_COUNT),
            })}
          </Note>
        </Section>

        {update.isError ? (
          <Section>
            <Problem>{t("That did not save. Try again.")}</Problem>
          </Section>
        ) : null}
        {saved && !dirty ? (
          <Section>
            <Confirmation>{t("Preferences saved.")}</Confirmation>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
