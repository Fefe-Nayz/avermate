"use client";

import { CustomAveragesSection } from '@/app/profile/settings/custom-averages-section';
import { PeriodsSection } from '@/app/profile/settings/periods-section';
import DeleteYearSection from '@/components/dashboard/year-settings/delete-year-section';
import UpdateYearSection from '@/components/dashboard/year-settings/update-year-section';
import { Separator } from '@/components/ui/separator';
import { useYears } from '@/hooks/use-years';
import { useActiveYearStore } from '@/stores/active-year-store';
import React from 'react'
import { useTranslations } from "next-intl";

export default function YearSettingsPage() {
    const { activeId } = useActiveYearStore();
    const { data: years } = useYears();
    const year = years?.find((year) => year.id === activeId);
    const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE");

    if (activeId === "none" || !year) {
        return <div>Loading...</div>;
    }

    return (
        <main className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
            <div className="flex flex-wrap items-center justify-between min-h-9">
                <h1 className="md:text-3xl font-bold text-xl">{t("YEAR_SETTINGS_PAGE_TITLE")}</h1>
            </div>

            <Separator />

            <UpdateYearSection yearId={activeId} />
            <PeriodsSection yearId={activeId} />
            <CustomAveragesSection yearId={activeId} />
            <DeleteYearSection yearId={activeId} />
        </main>
    )
}
