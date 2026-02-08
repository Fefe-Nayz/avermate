"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScrollDirection } from "@/hooks/use-scroll-direction";
import {
  LayoutDashboard,
  BookOpen,
  CalendarCog,
  Settings,
  Plus,
} from "lucide-react";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
import { useActiveYearStore } from "@/stores/active-year-store";
import { useEffect, useState } from "react";
import { BodyPortal } from "@/components/portal/body-portal";

export default function DashboardNav() {
  const t = useTranslations("Dashboard.Nav");
  const path = usePathname();
  const isMobile = useIsMobile();
  const { scrollDirection } = useScrollDirection();
  const { activeId } = useActiveYearStore();
  const [isAtBottom, setIsAtBottom] = useState(false);

  const routes = [
    {
      label: t("overview"),
      path: "/dashboard",
      icon: LayoutDashboard,
    },
    {
      label: t("grades"),
      path: "/dashboard/grades",
      icon: BookOpen,
    },
    {
      label: t("YEAR_SETTINGS_PAGE_TITLE"),
      path: "/dashboard/settings",
      icon: CalendarCog,
    },
    {
      label: t("settings"),
      path: "/profile/settings",
      icon: Settings,
    },
    {
      label: t("addGrade"),
      path: "/dashboard/grades",
      icon: Plus,
      isAddButton: true,
    },
  ];

  // Show navbar when scrolling up, at top, or at bottom (mobile logic)
  const shouldShow = scrollDirection === "up" || scrollDirection === null;

  // Helper function to determine if a route is active
  const getIsActiveRoute = (route: (typeof routes)[0], currentPath: string) => {
    if (route.path === "/profile/settings") {
      return currentPath.startsWith("/profile");
    }
    if (route.path === "/dashboard/grades") {
      return (
        currentPath === route.path ||
        currentPath.startsWith("/dashboard/grades/") ||
        currentPath.startsWith("/dashboard/subjects/")
      );
    }
    return currentPath === route.path;
  };

  return (
    <>
      {/* Mobile navbar - fixed at bottom with scroll behavior */}
      <BodyPortal>
        <nav
          className={cn(
            "fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur border-t z-50 transition-transform duration-300 md:hidden",
            shouldShow ? "translate-y-0" : "translate-y-full"
          )}
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {/* Align bottoms so the center can be taller than the sides */}
          <div className="flex justify-center px-2 py-1.5 gap-1">
            {/* Left navigation buttons - equal width; equal height within the group */}
            <div className="flex flex-1 basis-0 min-w-0 gap-1 items-stretch">
              {routes.slice(0, 2).map((route) => {
                const Icon = route.icon;
                const isActive = getIsActiveRoute(route, path);

                return (
                  <Link
                    key={route.path}
                    href={route.path}
                    className="flex flex-col items-center justify-center flex-1 basis-0 min-w-0"
                  >
                    <div
                      className={cn(
                        // compact side tabs
                        "flex flex-col items-center justify-center rounded-lg transition-all w-full min-h-[48px] px-2 py-1",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon className="size-4 mb-0.5 flex-shrink-0" />
                      <span className="text-[10px] font-medium text-center leading-tight whitespace-normal break-words w-full">
                        {route.label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Add Grade Button - Center */}
            {activeId && (
              <AddGradeDialog yearId={activeId}>
                <div className="flex flex-col items-center justify-center mx-0.5">
                  <div className="flex flex-col items-center justify-center rounded-full transition-all size-[52px] bg-foreground text-background hover:bg-foreground/80">
                    <Plus className="size-5 flex-shrink-0" />
                  </div>
                </div>
              </AddGradeDialog>
            )}

            {/* Right navigation buttons - equal width; equal height within the group */}
            <div className="flex flex-1 basis-0 min-w-0 gap-1 items-stretch">
              {routes.slice(2, 4).map((route) => {
                const Icon = route.icon;
                const isActive = getIsActiveRoute(route, path);

                return (
                  <Link
                    key={route.path}
                    href={route.path}
                    className="flex flex-col items-center justify-center flex-1 basis-0 min-w-0"
                  >
                    <div
                      className={cn(
                        // compact side tabs
                        "flex flex-col items-center justify-center rounded-lg transition-all w-full min-h-[48px] px-2 py-1",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon className="size-4 mb-0.5 flex-shrink-0" />
                      <span className="text-[10px] font-medium text-center leading-tight whitespace-normal break-words w-full">
                        {route.label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      </BodyPortal>

      {/* Desktop navbar - horizontal navigation */}
      <nav className="sticky px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 pt-4 hidden md:block">
        <div className="flex items-center border-b mx-auto max-w-[2000px]">
          <ul className="flex items-center">
            {routes.slice(0, 3).map((route) => {
              const Icon = route.icon;
              const isActive = getIsActiveRoute(route, path);

              return (
                <li key={route.path}>
                  <Link
                    href={route.path}
                    className={cn(
                      "flex items-center gap-2 p-4 text-sm border-b-2 border-transparent hover:border-black dark:hover:border-white transition-all outline-none focus-visible:rounded-md focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                      isActive && "border-black dark:border-white"
                    )}
                  >
                    <Icon className="size-4 flex-shrink-0" />
                    <span className="whitespace-normal break-words">
                      {route.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </>
  );
}
