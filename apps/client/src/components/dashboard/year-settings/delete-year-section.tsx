"use client";

import ProfileSection from '@/app/profile/profile-section'
import DeleteYearDialog from '@/components/dialogs/delete-year-dialog';
import ErrorStateCard from '@/components/skeleton/error-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useYears } from '@/hooks/use-years';
import React from 'react'
import { useTranslations } from 'next-intl';

export default function DeleteYearSection({ yearId }: { yearId: string }) {
    const { data, isPending, isError } = useYears();
    const year = data?.find((year) => year.id === yearId);
    const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.DELETE_YEAR_SECTION");

    if (isPending) return <Skeleton className="h-[200px] w-full" />;
    if (isError || !year) return <div>{ErrorStateCard()}</div>;

    return (
        <ProfileSection className="border-red-500" title={t("DELETE_YEAR_SECTION_TITLE")} description={t("DELETE_YEAR_SECTION_DESCRIPTION")}>
            <div className="flex justify-end">
                <DeleteYearDialog year={year} />
            </div>
        </ProfileSection>
    )
}
