"use client";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export default function GradesSection({ yearId }: { yearId: string }) {
  const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.GRADES_SECTION");

  return (
    <Card className="gap-0">
      <CardHeader className="pb-6">
        <CardTitle>{t("GRADES_SECTION_TITLE")}</CardTitle>
        <CardDescription>{t("GRADES_SECTION_DESCRIPTION")}</CardDescription>
      </CardHeader>
      <div className="flex justify-end rounded-b-xl border-t bg-card px-6 pt-6 pb-0">
        <Button asChild>
          <Link href="/dashboard/settings/grades">
            <IconAdjustmentsHorizontal className="size-4" />
            {t("GRADES_SECTION_BUTTON")}
          </Link>
        </Button>
      </div>
    </Card>
  );
}
