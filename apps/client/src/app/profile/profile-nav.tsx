"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  Cog6ToothIcon,
  ShieldCheckIcon,
  UserIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export default function ProfileNav({ onBack }: { onBack: () => void }) {
  const t = useTranslations("Settings.Nav");
  const path = usePathname();

  const isActiveRoute = (routePath: string) => {
    if (routePath === "/profile/settings") {
      return path === routePath || path.startsWith("/profile/settings/");
    }

    return path === routePath;
  };

  const routes = [
    {
      icon: UserIcon,
      label: t("profile"),
      path: "/profile",
    },
    {
      icon: ShieldCheckIcon,
      label: t("accountSecurity"),
      path: "/profile/account",
    },
    {
      icon: Cog6ToothIcon,
      label: t("settings"),
      path: "/profile/settings",
    },
    {
      icon: InformationCircleIcon,
      label: t("about"),
      path: "/profile/about",
    },
  ];

  const backButton = (
    <li className="w-full">
      <Button
        className={cn(
          "w-full h-full",
          "2xl:flex-row 2xl:justify-start", // Extra large screens: icon + label left-aligned
          "lg:flex-col lg:justify-center", // Large screens: icon only centered, stay in column
          "flex-col justify-center" // Small screens: icon centered + label below
        )}
        variant="ghost"
        onClick={onBack}
      >
        <ArrowLeftIcon className="size-4 2xl:mr-2" />
        <p
          className={cn(
            "text-xs 2xl:text-sm",
            "2xl:block", // Show on 2xl screens
            "sm:hidden", // Hide on large screens
            "hidden mt-1 lg:mt-0" // Show below icon on small screens
          )}
        >
          {t("back")}
        </p>
      </Button>
    </li>
  );

  return (
    <nav>
      <ul className="flex flex-row sm:flex-col gap-1 sm:gap-4 w-full">
        {/* Conditionally render back button as the first or last item */}
        <div className="flex flex-row sm:flex-col gap-1 sm:gap-4 w-full">
          <div className="block sm:hidden w-full">{backButton}</div>
          {routes.map((route) => (
            <li key={route.path} className="w-full">
              <Button
                className={cn(
                  "w-full h-full",
                  "2xl:flex-row 2xl:justify-start", // Extra large screens: icon + label left-aligned
                  "lg:flex-col lg:justify-center", // Large screens: icon only centered, stay in column
                  "flex-col justify-center", // Small screens: icon centered + label below
                  isActiveRoute(route.path) ? "bg-primary/10" : ""
                )}
                variant="ghost"
                asChild
              >
                <Link
                  href={route.path}
                  className="flex flex-col lg:flex-col 2xl:flex-row items-center"
                >
                  <route.icon className="size-4 2xl:mr-2" />
                  <p
                    className={cn(
                      "text-xs 2xl:text-sm",
                      "2xl:block", // Show on 2xl screens
                      "sm:hidden", // Hide on large screens
                      "hidden mt-1 lg:mt-0" // Show below icon on small screens
                    )}
                  >
                    {route.label}
                  </p>
                </Link>
              </Button>
            </li>
          ))}
          <div className="hidden sm:block">{backButton}</div>
        </div>
      </ul>
    </nav>
  );
}
