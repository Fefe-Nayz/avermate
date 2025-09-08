"use client";

import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircleIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function GradesSection({ yearId }: { yearId: string }) {
    const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.GRADES_SECTION");

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    {t("GRADES_SECTION_TITLE")}
                </CardTitle>
                <CardDescription>
                    {t("GRADES_SECTION_DESCRIPTION")}
                </CardDescription>
            </CardHeader>
            <div className="justify-end flex rounded-b-xl px-6 py-4 border-t bg-muted/30">
                <Link href="/dashboard/settings/grades">
                    <Button>
                        <PlusCircleIcon className="size-4 mr-2" />
                        {t("GRADES_SECTION_BUTTON")}
                    </Button>
                </Link>
            </div>
        </Card>
    );
}
