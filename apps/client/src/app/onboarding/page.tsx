"use client";

import { CreateYearForm } from '@/components/forms/create-year-form'
import { useTranslations } from 'next-intl';
import React from 'react'

export default function YearCreationPage() {
    const t = useTranslations("Dashboard.Forms.CREATE_YEAR_FORM");

    return (
        <main className="flex justify-center">
            <div className="flex flex-col gap-8 w-full max-w-[650px]">
                <div className="flex flex-col gap-2">
                    <p className="text-3xl md:text-4xl font-bold">{t("CREATE_YEAR_TITLE")}</p>

                    <p className="flex flex-col gap-0.5 text-sm md:text-base text-muted-foreground">{t("CREATE_YEAR_DESC")}</p>
                </div>

                <CreateYearForm />
            </div>
        </main>
    )
}
