"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { Button } from "../ui/button";

export const GetStartedButton = ({ headerStyle = false }: { headerStyle?: boolean }) => {
  const t = useTranslations("Landing.Headline");

  if (headerStyle) {
    return (
      <Link
        href="/auth/sign-up"
        className="bg-secondary flex h-8 items-center justify-center text-sm font-normal tracking-wide rounded-full text-secondary-foreground w-fit px-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] border border-white/[0.12]"
      >
        {t("getStarted")}
      </Link>
    );
  }

  return (
    <div className="h-12 flex items-center justify-center">
      <Button size="default" asChild className="hidden sm:inline-flex group">
        <Link href="/auth/sign-up">
          {t("getStarted")}
          <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </Button>
      <Button size="sm" asChild className="inline-flex sm:hidden group">
        <Link href="/auth/sign-up">
          {t("getStarted")}
          <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </Button>
    </div>
  );
};
