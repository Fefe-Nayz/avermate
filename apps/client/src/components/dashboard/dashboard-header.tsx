"use client";

import * as React from "react";
import AccountDropdown from "@/components/buttons/account/account-dropdown";
import Logo from "@/components/logo";
import YearWorkspaceSelect from "../selects/year-workspace-select";
import { useScrollDirection } from "@/hooks/use-scroll-direction";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePathname, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { BodyPortal } from "@/components/portal/body-portal";
import { useGrade } from "@/hooks/use-grade";
import { useSubject } from "@/hooks/use-subject";
import { Grade } from "@/types/grade";
import { Subject } from "@/types/subject";

interface DashboardHeaderProps {
  hideWorkspaces?: boolean;
}

const getPageTitle = (
  pathname: string,
  t: any,
  grade?: Grade,
  subject?: Subject
) => {
  if (pathname === "/dashboard") {
    return t("Dashboard.Pages.OverviewPage.overviewTitle");
  }
  if (pathname === "/dashboard/grades") {
    return t("Dashboard.Pages.GradesPage.gradesTitle");
  }

  // Handle grade details pages
  if (pathname.startsWith("/dashboard/grades/") && grade) {
    return grade.name;
  }

  // Handle subject details pages
  if (pathname.startsWith("/dashboard/subjects/") && subject) {
    return subject.name;
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

  if (pathname === "/dashboard/admin") {
    return t("Dashboard.Pages.AdminPage.title");
  }

  // Handle profile/settings pages
  if (pathname === "/profile") {
    return t("Settings.Nav.profile");
  }
  if (pathname === "/profile/account") {
    return t("Settings.Nav.accountSecurity");
  }
  if (pathname === "/profile/settings") {
    return t("Settings.Nav.settings");
  }
  if (pathname === "/profile/about") {
    return t("Settings.Nav.about");
  }

  if (pathname === "/dashboard/settings/grades") {
    return t("Dashboard.Pages.GRADES_SECTION.GRADES_SECTION_TITLE");
  }


  return t("Dashboard.Pages.OverviewPage.overviewTitle");
};

export default function DashboardHeader({
  hideWorkspaces,
}: DashboardHeaderProps) {
  const { scrollDirection, isAtTop } = useScrollDirection();
  const pathname = usePathname();
  const params = useParams();
  const t = useTranslations();
  const isMobile = useIsMobile();

  const gradeId = params?.gradeId as string | undefined;
  const subjectId = params?.subjectId as string | undefined;

  // Get grade and subject data (hooks handle undefined IDs gracefully)
  const gradeQuery = useGrade(gradeId);
  const subjectQuery = useSubject(subjectId, false);

  const grade = gradeQuery?.data;
  const subject = subjectQuery?.data;

  // Header scroll behavior only on mobile
  const isCompact = isMobile && scrollDirection === "down";
  // Show title on mobile when scrolled down (not at top)
  const showTitle = isMobile && !isAtTop;
  const pageTitle = getPageTitle(pathname, t, grade, subject);

  // Measure the rendered header height so we can insert a spacer in flow on mobile
  const headerRef = React.useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = React.useState<number>(56); // sensible default

  React.useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
    };
  }, [isMobile]); // remount observer when switching form factors

  // The actual header content (shared by fixed/portaled vs in-flow versions)
  const HeaderInner = (
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
                "transition-all duration-300",
                isCompact
                  ? "w-0 overflow-hidden opacity-0 pointer-events-none"
                  : "w-auto overflow-visible opacity-100"
              )}
            >
              <YearWorkspaceSelect />
            </div>
          )}
          <AccountDropdown />
        </div>
      </div>
    </div>
  );

  // Desktop: original in-flow (no portal, no sticky)
  if (!isMobile) {
    return (
      <header
        ref={headerRef}
        className={cn("border-b transition-all duration-300", "py-4 sm:py-8")}
      >
        {HeaderInner}
      </header>
    );
  }

  // Mobile: spacer in flow + portaled fixed header outside Vaul wrapper
  return (
    <>
      {/* Spacer so content isn't overlapped by the fixed, portaled header */}
      <div style={{ height: headerHeight }} aria-hidden />

      <BodyPortal>
        <header
          ref={headerRef}
          className={cn(
            "fixed top-0 left-0 right-0 z-40 border-b transition-all duration-300",
            "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
            isCompact ? "py-2" : "py-4 sm:py-8"
          )}
        >
          {HeaderInner}
        </header>
      </BodyPortal>
    </>
  );
}
