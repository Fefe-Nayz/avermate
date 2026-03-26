"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { useDeferredValue, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CalendarCog,
  ChevronLeft,
  ChevronRight,
  Info,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getUserSettingsStorageEventName,
  readLocalUserSettings,
} from "@/lib/user-settings-storage";
import { cn } from "@/lib/utils";

type SettingsPageCard = {
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  id: string;
  keywords: string[];
  title: string;
};

type SettingsSearchResult = {
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  id: string;
  keywords: string[];
  parentTitle: string;
  settingId?: string;
  title: string;
};

export function getMobileSettingsTitle(
  pathname: string,
  t: (key: string) => string
) {
  switch (pathname) {
    case "/profile":
      return t("profile");
    case "/profile/account":
      return t("accountSecurity");
    case "/profile/about":
      return t("about");
    case "/profile/settings/general":
      return t("general");
    default:
      return null;
  }
}

export function MobileSettingsDetailHeader({
  className,
  href = "/profile/settings",
  title,
}: {
  className?: string;
  href?: string;
  title: string;
}) {
  const t = useTranslations("Settings.Nav");

  return (
    <div className={cn("md:hidden", className)}>
      <Button
        asChild
        className="mb-3 h-11 rounded-xl px-4 text-sm font-medium"
        size="sm"
        variant="outline"
      >
        <Link href={href}>
          <ChevronLeft className="size-4" />
          {t("back")}
        </Link>
      </Button>

      <div className="rounded-xl border border-border/70 bg-card/85 px-5 py-4 shadow-sm backdrop-blur">
        <p className="text-lg font-semibold tracking-tight">{title}</p>
      </div>
    </div>
  );
}

function matchesQuery(
  entry: Pick<SettingsPageCard, "description" | "keywords" | "title">,
  normalizedQuery: string
) {
  return [entry.title, entry.description, ...entry.keywords]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function getMatchScore(
  entry: Pick<SettingsSearchResult, "description" | "keywords" | "title">,
  normalizedQuery: string
) {
  const normalizedTitle = entry.title.toLowerCase();
  const normalizedDescription = entry.description.toLowerCase();
  const normalizedKeywords = entry.keywords.map((keyword) =>
    keyword.toLowerCase()
  );

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 0;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 1;
  }

  if (normalizedKeywords.some((keyword) => keyword.startsWith(normalizedQuery))) {
    return 2;
  }

  if (
    normalizedKeywords.some((keyword) => keyword.includes(normalizedQuery)) ||
    normalizedDescription.includes(normalizedQuery)
  ) {
    return 3;
  }

  return 4;
}

function getSearchHref(result: SettingsSearchResult) {
  return result.settingId
    ? `${result.href}?setting=${result.settingId}`
    : result.href;
}

export function MobileSettingsHub() {
  const navT = useTranslations("Settings.Nav");
  const profileT = useTranslations("Settings.Profile");
  const accountT = useTranslations("Settings.Account");
  const settingsT = useTranslations("Settings.Settings");
  const aboutT = useTranslations("Settings.About");
  const yearSettingsT = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE");

  const [query, setQuery] = useState("");
  const [hasMokattamTheme, setHasMokattamTheme] = useState(false);
  const normalizedQuery = useDeferredValue(query.trim().toLowerCase());
  const showSearchResults = normalizedQuery.length > 0;

  useEffect(() => {
    const syncSettings = () => {
      setHasMokattamTheme(readLocalUserSettings().settings.mokattamThemeAvailable);
    };

    syncSettings();
    window.addEventListener(getUserSettingsStorageEventName(), syncSettings);

    return () => {
      window.removeEventListener(getUserSettingsStorageEventName(), syncSettings);
    };
  }, []);

  const pageCards: SettingsPageCard[] = [
    {
      id: "profile",
      href: "/profile",
      icon: UserRound,
      title: navT("profile"),
      description: navT("profileDescription"),
      keywords: [
        profileT("Avatar.title"),
        profileT("Name.title"),
        profileT("Email.title"),
      ],
    },
    {
      id: "account",
      href: "/profile/account",
      icon: ShieldCheck,
      title: navT("accountSecurity"),
      description: navT("accountDescription"),
      keywords: [
        accountT("LinkedAccounts.title"),
        accountT("SessionList.title"),
        accountT("DeleteAccount.title"),
      ],
    },
    {
      id: "general",
      href: "/profile/settings/general",
      icon: Settings2,
      title: navT("general"),
      description: navT("generalDescription"),
      keywords: [
        settingsT("Theme.title"),
        settingsT("Language.title"),
        settingsT("ChartSettings.title"),
        settingsT("TimelineMode.title"),
        settingsT("Haptics.title"),
        settingsT("SeasonalThemes.title"),
        ...(hasMokattamTheme ? [settingsT("MokattamTheme.title")] : []),
        settingsT("DeveloperOptions.title"),
      ],
    },
    {
      id: "year-settings",
      href: "/dashboard/settings",
      icon: CalendarCog,
      title: navT("yearSettings"),
      description: navT("yearSettingsDescription"),
      keywords: [
        yearSettingsT("UPDATE_YEAR_SECTION.UPDATE_YEAR_NAME_SECTION_TITLE"),
        settingsT("Periods.title"),
        settingsT("CustomAverages.title"),
        yearSettingsT("GRADES_SECTION.GRADES_SECTION_TITLE"),
        yearSettingsT("DELETE_YEAR_SECTION.DELETE_YEAR_SECTION_TITLE"),
      ],
    },
    {
      id: "about",
      href: "/profile/about",
      icon: Info,
      title: navT("about"),
      description: navT("aboutDescription"),
      keywords: [
        aboutT("contributors"),
        aboutT("usefulLinks"),
        aboutT("viewOnGitHub"),
      ],
    },
  ];

  const searchResults: SettingsSearchResult[] = [
    ...pageCards.map((pageCard) => ({
      ...pageCard,
      parentTitle: navT("settings"),
    })),
    {
      id: "profile-avatar",
      href: "/profile",
      icon: UserRound,
      parentTitle: navT("profile"),
      settingId: "avatar",
      title: profileT("Avatar.title"),
      description: profileT("Avatar.description"),
      keywords: [navT("profile"), navT("profileDescription")],
    },
    {
      id: "profile-name",
      href: "/profile",
      icon: UserRound,
      parentTitle: navT("profile"),
      settingId: "name",
      title: profileT("Name.title"),
      description: profileT("Name.description"),
      keywords: [navT("profile"), navT("profileDescription")],
    },
    {
      id: "profile-email",
      href: "/profile",
      icon: UserRound,
      parentTitle: navT("profile"),
      settingId: "email",
      title: profileT("Email.title"),
      description: profileT("Email.description"),
      keywords: [navT("profile"), navT("profileDescription")],
    },
    {
      id: "account-linked-accounts",
      href: "/profile/account",
      icon: ShieldCheck,
      parentTitle: navT("accountSecurity"),
      settingId: "linked-accounts",
      title: accountT("LinkedAccounts.title"),
      description: accountT("LinkedAccounts.description"),
      keywords: [navT("accountSecurity"), navT("accountDescription")],
    },
    {
      id: "account-sessions",
      href: "/profile/account",
      icon: ShieldCheck,
      parentTitle: navT("accountSecurity"),
      settingId: "sessions",
      title: accountT("SessionList.title"),
      description: accountT("SessionList.description"),
      keywords: [navT("accountSecurity"), navT("accountDescription")],
    },
    {
      id: "account-delete",
      href: "/profile/account",
      icon: ShieldCheck,
      parentTitle: navT("accountSecurity"),
      settingId: "delete-account",
      title: accountT("DeleteAccount.title"),
      description: accountT("DeleteAccount.description"),
      keywords: [navT("accountSecurity"), navT("accountDescription")],
    },
    {
      id: "general-theme",
      href: "/profile/settings/general",
      icon: Settings2,
      parentTitle: navT("general"),
      settingId: "theme",
      title: settingsT("Theme.title"),
      description: settingsT("Theme.description"),
      keywords: [
        navT("general"),
        settingsT("Theme.system"),
        settingsT("Theme.light"),
        settingsT("Theme.dark"),
      ],
    },
    {
      id: "general-language",
      href: "/profile/settings/general",
      icon: Settings2,
      parentTitle: navT("general"),
      settingId: "language",
      title: settingsT("Language.title"),
      description: settingsT("Language.description"),
      keywords: [
        navT("general"),
        settingsT("Language.system"),
        settingsT("Language.english"),
        settingsT("Language.french"),
      ],
    },
    {
      id: "general-chart-settings",
      href: "/profile/settings/general",
      icon: Settings2,
      parentTitle: navT("general"),
      settingId: "chart-settings",
      title: settingsT("ChartSettings.title"),
      description: settingsT("ChartSettings.description"),
      keywords: [
        settingsT("ChartSettings.autoZoomYAxis"),
        settingsT("ChartSettings.showTrendLine"),
      ],
    },
    {
      id: "general-timeline-mode",
      href: "/profile/settings/general",
      icon: Settings2,
      parentTitle: navT("general"),
      settingId: "timeline-mode",
      title: settingsT("TimelineMode.title"),
      description: settingsT("TimelineMode.description"),
      keywords: [settingsT("TimelineMode.open"), navT("general")],
    },
    {
      id: "general-haptics",
      href: "/profile/settings/general",
      icon: Settings2,
      parentTitle: navT("general"),
      settingId: "haptics",
      title: settingsT("Haptics.title"),
      description: settingsT("Haptics.description"),
      keywords: [settingsT("Haptics.enableHaptics"), navT("general")],
    },
    {
      id: "general-seasonal-themes",
      href: "/profile/settings/general",
      icon: Settings2,
      parentTitle: navT("general"),
      settingId: "seasonal-themes",
      title: settingsT("SeasonalThemes.title"),
      description: settingsT("SeasonalThemes.description"),
      keywords: [settingsT("SeasonalThemes.enableSeasonalThemes"), navT("general")],
    },
    ...(hasMokattamTheme
      ? [
          {
            id: "general-mokattam-theme",
            href: "/profile/settings/general",
            icon: Settings2,
            parentTitle: navT("general"),
            settingId: "mokattam-theme",
            title: settingsT("MokattamTheme.title"),
            description: settingsT("MokattamTheme.description"),
            keywords: [
              settingsT("MokattamTheme.enable"),
              settingsT("MokattamTheme.badgeLabel"),
              navT("general"),
            ],
          },
        ]
      : []),
    {
      id: "general-developer-options",
      href: "/profile/settings/general",
      icon: Settings2,
      parentTitle: navT("general"),
      settingId: "developer-options",
      title: settingsT("DeveloperOptions.title"),
      description: settingsT("DeveloperOptions.description"),
      keywords: [settingsT("DeveloperOptions.toggle"), settingsT("UserId.label")],
    },
    {
      id: "year-name",
      href: "/dashboard/settings",
      icon: CalendarCog,
      parentTitle: navT("yearSettings"),
      settingId: "year-workspace",
      title: yearSettingsT("UPDATE_YEAR_SECTION.UPDATE_YEAR_NAME_SECTION_TITLE"),
      description: yearSettingsT("UPDATE_YEAR_SECTION.UPDATE_YEAR_NAME_SECTION_DESCRIPTION"),
      keywords: [navT("yearSettings"), navT("yearSettingsDescription")],
    },
    {
      id: "year-default-scale",
      href: "/dashboard/settings",
      icon: CalendarCog,
      parentTitle: navT("yearSettings"),
      settingId: "year-workspace",
      title: yearSettingsT("UPDATE_YEAR_SECTION.UPDATE_YEAR_DEFAULT_OUT_OF_SECTION_TITLE"),
      description: yearSettingsT("UPDATE_YEAR_SECTION.UPDATE_YEAR_DEFAULT_OUT_OF_SECTION_DESCRIPTION"),
      keywords: [navT("yearSettings"), navT("yearSettingsDescription")],
    },
    {
      id: "year-duration",
      href: "/dashboard/settings",
      icon: CalendarCog,
      parentTitle: navT("yearSettings"),
      settingId: "year-workspace",
      title: yearSettingsT("UPDATE_YEAR_SECTION.UPDATE_YEAR_DATE_RANGE_SECTION_TITLE"),
      description: yearSettingsT("UPDATE_YEAR_SECTION.UPDATE_YEAR_DATE_RANGE_SECTION_DESCRIPTION"),
      keywords: [navT("yearSettings"), navT("yearSettingsDescription")],
    },
    {
      id: "year-periods",
      href: "/dashboard/settings",
      icon: CalendarCog,
      parentTitle: navT("yearSettings"),
      settingId: "periods",
      title: settingsT("Periods.title"),
      description: settingsT("Periods.description"),
      keywords: [navT("yearSettings"), navT("yearSettingsDescription")],
    },
    {
      id: "year-custom-averages",
      href: "/dashboard/settings",
      icon: CalendarCog,
      parentTitle: navT("yearSettings"),
      settingId: "custom-averages",
      title: settingsT("CustomAverages.title"),
      description: settingsT("CustomAverages.description"),
      keywords: [navT("yearSettings"), navT("yearSettingsDescription")],
    },
    {
      id: "year-grades",
      href: "/dashboard/settings",
      icon: CalendarCog,
      parentTitle: navT("yearSettings"),
      settingId: "grades",
      title: yearSettingsT("GRADES_SECTION.GRADES_SECTION_TITLE"),
      description: yearSettingsT("GRADES_SECTION.GRADES_SECTION_DESCRIPTION"),
      keywords: [navT("yearSettings"), navT("yearSettingsDescription")],
    },
    {
      id: "year-delete",
      href: "/dashboard/settings",
      icon: CalendarCog,
      parentTitle: navT("yearSettings"),
      settingId: "delete-year",
      title: yearSettingsT("DELETE_YEAR_SECTION.DELETE_YEAR_SECTION_TITLE"),
      description: yearSettingsT("DELETE_YEAR_SECTION.DELETE_YEAR_SECTION_DESCRIPTION"),
      keywords: [navT("yearSettings"), navT("yearSettingsDescription")],
    },
  ];

  const filteredSearchResults = showSearchResults
    ? [...searchResults]
        .filter((entry) => matchesQuery(entry, normalizedQuery))
        .sort((left, right) => {
          const scoreDifference =
            getMatchScore(left, normalizedQuery) -
            getMatchScore(right, normalizedQuery);

          if (scoreDifference !== 0) {
            return scoreDifference;
          }

          return left.title.localeCompare(right.title);
        })
    : [];

  return (
    <div className="flex w-full flex-col gap-4 md:hidden">
      <section className="rounded-xl border border-border/70 bg-card/85 p-5 shadow-sm backdrop-blur">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {navT("settings")}
          </h1>
          <p className="text-sm leading-5 text-muted-foreground">
            {navT("searchHint")}
          </p>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-12 border-border/70 bg-background pl-11 pr-12 shadow-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={navT("search")}
            value={query}
          />

          {query ? (
            <Button
              className="absolute top-1/2 right-1.5 size-8 -translate-y-1/2 rounded-md text-muted-foreground"
              onClick={() => setQuery("")}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
              <span className="sr-only">{navT("clearSearch")}</span>
            </Button>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border/70 bg-card/85 shadow-sm backdrop-blur">
        {showSearchResults ? (
          filteredSearchResults.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {navT("noResults")}
            </div>
          ) : (
            filteredSearchResults.map((result, index) => (
              <Link
                className={cn(
                  "flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/50 active:bg-muted/70",
                  index > 0 && "border-t border-border/60"
                )}
                href={getSearchHref(result)}
                key={result.id}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                  <result.icon className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {result.parentTitle}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{result.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {result.description}
                  </p>
                </div>

                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          )
        ) : (
          pageCards.map((pageCard, index) => (
            <Link
              className={cn(
                "flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/50 active:bg-muted/70",
                index > 0 && "border-t border-border/60"
              )}
              href={pageCard.href}
              key={pageCard.id}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <pageCard.icon className="size-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{pageCard.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {pageCard.description}
                </p>
              </div>

              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
