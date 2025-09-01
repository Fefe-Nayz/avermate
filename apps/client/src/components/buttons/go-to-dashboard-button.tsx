"use client";

import { ChevronRightIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";

export const GoToDashboardButton = () => {
  const t = useTranslations("Landing.Headline");
  return (
    <div className="h-12 flex items-center justify-center">
      <Button size="default" asChild className="hidden sm:inline-flex group">
        <Link href="/dashboard">
          {t("goToDashboard")}
          <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </Button>
      <Button size="sm" asChild className="inline-flex sm:hidden group">
        <Link href="/dashboard">
          {t("goToDashboard")}
          <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </Button>
    </div>
  );
};
