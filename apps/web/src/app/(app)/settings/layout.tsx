"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useExtracted } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Settings.
 *
 * On a wide screen the sections sit in a rail beside the content. On a phone
 * they are ordinary pages reached from the "More" tab and left with the back
 * arrow — no nested navigation inside a scroll container.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useExtracted();
  const pathname = usePathname();

  const sections = [
    { href: "/settings", label: t("Profile"), exact: true },
    { href: "/settings/appearance", label: t("Appearance") },
    { href: "/settings/year", label: t("Year & periods") },
    { href: "/settings/averages", label: t("Custom averages") },
    { href: "/settings/account", label: t("Account") },
    { href: "/settings/about", label: t("About") },
  ];

  return (
    <div className="flex gap-8">
      <nav className="hidden w-52 shrink-0 md:block">
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">
          {t("Settings")}
        </h1>
        <ul className="flex flex-col gap-0.5">
          {sections.map((section) => {
            const active = section.exact
              ? pathname === section.href
              : pathname.startsWith(section.href);
            return (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
