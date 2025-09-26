"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
// import { ModeToggle } from "@/components/mode-toggle";
// import NotificationBell from "@/components/notifications/notification-bell";
// import SearchBar from "@/components/search-bar";
import { NavUser } from "@/components/dashboard/nav-user";
// import type { User } from "@/lib/auth-client";
import {
  Bell,
  Settings,
  MoreHorizontal,
  Sun as SunIcon,
  Moon as MoonIcon,
  Monitor as MonitorIcon,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
// import { useAnimatedThemeSetter } from "@/components/ui/theme-toggle-button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from "@/components/ui/breadcrumb";
import { Fragment, useCallback, useMemo } from "react";
// import { ResponsiveBreadcrumb } from "@/components/ui/responsive-breadcrumb";
import { useIsMobile } from "@/hooks/use-mobile";
import YearWorkspaceSelect from "../selects/year-workspace-select";

export function SiteHeader({}: {}) {
  // const setThemeAnimated = useAnimatedThemeSetter(undefined, "top-right");
  const pathname = usePathname();
  // const isMobile = useIsMobile();

  const segments = (pathname || "/dashboard").split("/").filter(Boolean);

  // Normalize to always start with dashboard
  const normalizedKeys = useMemo(() => {
    const keys = [...segments];
    if (keys[0] !== "dashboard") {
      keys.unshift("dashboard");
    }
    return keys;
  }, [segments]);

  const formatSegment = (segment: string) =>
    decodeURIComponent(segment)
      .replace(/-/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

  type Crumb = { key: string; label: string; href: string; clickable: boolean };

  const crumbs: Crumb[] = normalizedKeys.map((key, index) => {
    const href = `/${normalizedKeys.slice(0, index + 1).join("/")}`;
    const isLast = index === normalizedKeys.length - 1;
    const isSettings = key.toLowerCase() === "settings";
    return {
      key,
      label: key === "dashboard" ? "Dashboard" : formatSegment(key),
      href: key === "settings" ? "/settings/profile" : href,
      clickable: !isLast && !isSettings && key !== "...",
    };
  });

  const TOP_LEVEL_NAV = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Settings", href: "/settings/profile" },
  ];

  const SETTINGS_NAV = [
    { label: "Profile", href: "/settings/profile" },
    { label: "Account", href: "/settings/account" },
    { label: "Notifications", href: "/settings/notifications" },
    { label: "Plans", href: "/settings/plans" },
    { label: "Billing", href: "/settings/billing" },
    { label: "Appearence", href: "/settings/appearence" },
  ];

  function getNextLevelItems(prevKey: string) {
    if (prevKey === "dashboard") return TOP_LEVEL_NAV;
    if (prevKey === "settings") return SETTINGS_NAV;
    return [] as { label: string; href: string }[];
  }

  function SeparatorDropdown({ prevKey }: { prevKey: string }) {
    const items = getNextLevelItems(prevKey);
    if (!items.length) {
      return (
        <li
          data-slot="breadcrumb-separator"
          role="presentation"
          aria-hidden="true"
          className="[&>svg]:size-3.5"
        >
          <ChevronRight />
        </li>
      );
    }
    return (
      <li data-slot="breadcrumb-separator" className="relative">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 group"
              aria-label="Open next level"
            >
              <ChevronRight className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-90" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {items.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href}>{item.label}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  }
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        {/* <div className="min-w-0 flex-1">
          {(() => {
            if (crumbs.length === 0) {
              return (
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbPage>Dashboard</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              );
            }

            const renderSeparator = useCallback((prevKey: string) => {
              return <SeparatorDropdown prevKey={prevKey} />;
            }, []);

            return (
              <ResponsiveBreadcrumb
                items={crumbs}
                renderSeparator={renderSeparator}
              />
            );
          })()}
        </div> */}
        <div className="flex-1 min-w-0 px-2 flex justify-end">
          <div className="w-full max-w-[300px] min-w-28">
            {/* <SearchBar /> */}
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink-0">
          <Separator
            orientation="vertical"
            className="mx-2 data-[orientation=vertical]:h-4"
          />
          <div className="hidden min-[1001px]:flex items-center gap-2">
            {/* <ModeToggle classname="size-7" />
            <NotificationBell /> */}
            <Button variant="ghost" size="icon" className="size-7" asChild>
              <Link href="/settings/profile">
                <Settings className="size-4" />
              </Link>
            </Button>
            <Separator
              orientation="vertical"
              className="mx-2 data-[orientation=vertical]:h-4"
            />
          </div>
          <div className="min-[1001px]:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <button
                    type="button"
                    className="w-full inline-flex items-center gap-2"
                  >
                    <Bell className="size-4" />
                    <span className="flex-1 text-left">Notifications</span>
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href="/settings/profile"
                    className="w-full inline-flex items-center gap-2"
                  >
                    <Settings className="size-4" />
                    <span className="flex-1 text-left">Settings</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent alignOffset={-8}>
                    <DropdownMenuItem onClick={() => setThemeAnimated("light")}>
                      <SunIcon className="size-4" />
                      <span className="flex-1 text-left">Light</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setThemeAnimated("dark")}>
                      <MoonIcon className="size-4" />
                      <span className="flex-1 text-left">Dark</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setThemeAnimated("system")}
                    >
                      <MonitorIcon className="size-4" />
                      <span className="flex-1 text-left">System</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub> */}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <NavUser iconOnly />
          <YearWorkspaceSelect />
          {/* <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
            <a
              href="https://github.com/shadcn-ui/ui/tree/main/apps/v4/app/(examples)/dashboard"
              rel="noopener noreferrer"
              target="_blank"
              className="dark:text-foreground"
            >
              GitHub
            </a>
          </Button> */}
        </div>
      </div>
    </header>
  );
}
