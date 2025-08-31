"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export default function DashboardNav() {
  const t = useTranslations("Dashboard.Nav");
  const path = usePathname();

  const routes = [
    {
      label: t("overview"),
      path: "/dashboard",
    },
    {
      label: t("grades"),
      path: "/dashboard/grades",
    },
    {
      label: "DASHBOARD_NAV_SETTINGS_LABEL",
      path: "/dashboard/settings",
    },
  ];

  return (
    <nav className="sticky px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 pt-4">
      <ul className="flex items-center border-b mx-auto max-w-[2000px]">
        {routes.map((route) => (
          <Link key={route.path} href={route.path}>
            <li
              className={cn(
                "p-4 text-sm border-b-2 border-transparent hover:border-black dark:hover:border-white transition-all",
                path === route.path && "border-black dark:border-white"
              )}
            >
              {route.label}
            </li>
          </Link>
        ))}
      </ul>
    </nav>
  );
}
