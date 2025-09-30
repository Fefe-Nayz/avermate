"use client";

import AccountDropdown from "@/components/buttons/account/account-dropdown";
import Logo from "@/components/logo";
import YearWorkspaceSelect from "../selects/year-workspace-select";
import { useScrollDirection } from "@/hooks/use-scroll-direction";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface DashboardHeaderProps {
  hideWorkspaces?: boolean;
}

const getPageTitle = (pathname: string, t: any) => {
  if (pathname === "/dashboard") {
    return t("Dashboard.Pages.OverviewPage.overviewTitle");
  }
  if (pathname === "/dashboard/grades") {
    return t("Dashboard.Pages.GradesPage.gradesTitle");
  }
  if (
    pathname.startsWith("/dashboard/grades/") ||
    pathname.startsWith("/dashboard/subjects/")
  ) {
    return t("details");
  }
  if (pathname === "/dashboard/settings") {
    return t("Dashboard.Pages.YEAR_SETTINGS_PAGE.YEAR_SETTINGS_PAGE_TITLE");
  }
  if (pathname.startsWith("/profile")) {
    return t("Dashboard.Pages.SETTINGS_PAGE.SETTINGS_PAGE_TITLE");
  }
  return t("Dashboard.Pages.OverviewPage.overviewTitle");
};

export default function DashboardHeader({
  hideWorkspaces,
}: DashboardHeaderProps) {
  const { scrollDirection, isAtTop } = useScrollDirection();
  const pathname = usePathname();
  const t = useTranslations();
  const isMobile = useIsMobile();

  // Header scroll behavior only on mobile
  const isCompact = isMobile && scrollDirection === "down";
  // Show title on mobile when scrolled down (not at top)
  const showTitle = isMobile && !isAtTop;

  const pageTitle = getPageTitle(pathname, t);
  return (
    <header
      className={cn(
        "border-b transition-all duration-300",
        isMobile
          ? cn(
              "sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
              isCompact ? "py-2" : "py-4 sm:py-8"
            )
          : "py-4 sm:py-8"
      )}
    >
      <div className="flex justify-center px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96">
        <div className="flex w-full items-center justify-between gap-8 max-w-[2000px]">
          {/* Left side - Logo and Title (on mobile) */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Logo />
            {showTitle && (
              <h1 className="text-lg font-semibold text-foreground truncate min-w-0 flex-1">
                {pageTitle}
              </h1>
            )}
          </div>

          {/* Right side - Controls */}
          <div className="flex items-center justify-between gap-4 flex-shrink-0">
            {!hideWorkspaces && (
              <div
                className={cn(
                  "transition-all duration-300 overflow-hidden",
                  isCompact
                    ? "w-0 opacity-0 pointer-events-none"
                    : "w-auto opacity-100"
                )}
              >
                <YearWorkspaceSelect />
              </div>
            )}
            <AccountDropdown />
          </div>
        </div>
      </div>
    </header>
  );
}
