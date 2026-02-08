"use client";

import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function GradesSection({ yearId }: { yearId: string }) {
    const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.GRADES_SECTION");

    return (
      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{t("GRADES_SECTION_TITLE")}</CardTitle>
          <CardDescription>{t("GRADES_SECTION_DESCRIPTION")}</CardDescription>
        </CardHeader>
        <div className="justify-end flex rounded-b-xl px-6 py-4 border-t bg-muted/30">
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
