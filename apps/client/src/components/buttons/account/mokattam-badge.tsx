"use client";

import { Flame } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

export default function MokattamBadge() {
  const t = useTranslations("BADGE");

  return (
    <span className="ml-1">
      <Badge className="border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-500/35 dark:bg-orange-500/15 dark:text-orange-200">
        <Flame className="-ms-0.5 mr-1 opacity-70" size={12} aria-hidden="true" />
        {t("MOKATTAM_BADGE_LABEL")}
      </Badge>
    </span>
  );
}
