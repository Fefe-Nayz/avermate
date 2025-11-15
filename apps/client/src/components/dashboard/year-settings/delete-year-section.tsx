"use client";

import ProfileSection from '@/app/profile/profile-section'
import DeleteYearDialog from '@/components/dialogs/delete-year-dialog';
import ErrorStateCard from '@/components/skeleton/error-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useYears } from '@/hooks/use-years';
import React from 'react'
import { useTranslations } from 'next-intl';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function DeleteYearSection({ yearId }: { yearId: string }) {
    const { data, isPending, isError } = useYears();
    const year = data?.find((year) => year.id === yearId);
    const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.DELETE_YEAR_SECTION");

    if (isPending) return <Skeleton className="h-[200px] w-full" />;
    if (isError || !year) return <div>{ErrorStateCard()}</div>;

    return (
        <Card className="border-destructive/40 pb-0">
            <CardHeader>
                <CardTitle>
                    {t("DELETE_YEAR_SECTION_TITLE")}
                </CardTitle>
                <CardDescription>
                    {t("DELETE_YEAR_SECTION_DESCRIPTION")}
                </CardDescription>
            </CardHeader>
            <div className="justify-end flex rounded-b-xl px-6 py-4 border-t border-destructive/30 bg-destructive/10">
                <DeleteYearDialog year={year} />
            </div>
        </Card>
    )
}
