import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Icon, type IconName } from "@/components/icon";
import { Card, Heading, Row, Screen, Section } from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import { usePalette } from "@/lib/theme";
import { NAV_TAB_ENTRIES, useNavigationTabs } from "@/lib/navigation-settings";

/**
 * Everything that did not earn a tab, one tap away.
 *
 * The first section mirrors the tab choice: whichever of the six
 * destinations are not pinned right now appear here, so changing the pinned
 * three never makes a screen unreachable. Below it, the fixed rooms of the
 * app — review, announcements, settings — and the admin door for the few
 * accounts that have one.
 */
export default function More() {
  const palette = usePalette();
  const router = useRouter();
  const chosen = useNavigationTabs();
  const admin = useQuery(orpc.admin.access.queryOptions());

  const pinned = new Set(chosen.map((entry) => entry.href));
  const rest = NAV_TAB_ENTRIES.filter((entry) => !pinned.has(entry.href));

  const leading = (name: IconName) => (
    <Icon name={name} size={20} color={palette.textMuted} />
  );

  return (
    <Screen>
      <Heading icon="ellipsis" title={t("More")} />

      <Section>
        <Card padded={false}>
          {rest.map((entry, index) => (
            <Row
              key={entry.href}
              first={index === 0}
              leading={leading(entry.icon)}
              title={t(entry.label)}
              onPress={() =>
                router.push(
                  (entry.route === "index" ? "/" : `/${entry.route}`) as never,
                )
              }
            />
          ))}
        </Card>
      </Section>

      <Section>
        <Card padded={false}>
          <Row
            first
            leading={leading("sparkles")}
            title={t("Year in review")}
            onPress={() => router.push("/review")}
          />
          <Row
            leading={leading("megaphone-outline")}
            title={t("Announcements")}
            onPress={() => router.push("/announcements")}
          />
          <Row
            leading={leading("settings")}
            title={t("Settings")}
            onPress={() => router.push("/settings")}
          />
          {admin.data?.isAdmin ? (
            <Row
              leading={leading("shield")}
              title={t("Administration")}
              onPress={() => router.push("/admin")}
            />
          ) : null}
        </Card>
      </Section>
    </Screen>
  );
}
