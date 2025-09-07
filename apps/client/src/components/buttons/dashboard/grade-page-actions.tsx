"use client";

import AddPeriodDialog from '@/components/dialogs/add-period-dialog'
import AddSubjectDialog from '@/components/dialogs/add-subject-dialog'
import { BookIcon, CalendarIcon } from 'lucide-react'
import React from 'react'
import { AddGradeButton } from './grade/add-grade-button'
import MoreButton from './more-button'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { BookOpenIcon } from '@heroicons/react/24/outline';

export default function GradePageActions({ activeId }: { activeId: string }) {
    const t = useTranslations("Dashboard.Pages.GradesPage");

    return (
        <>
            {/* Desktop */}
            <div className=" gap-4 hidden lg:flex">
                <AddGradeButton yearId={activeId} />

                <AddSubjectDialog yearId={activeId}>
                    <Button variant="outline">
                        <BookOpenIcon className="size-4 mr-2" />
                        {t("addSubject")}
                    </Button>
                </AddSubjectDialog>

                <AddPeriodDialog yearId={activeId}>
                    <Button variant="outline">
                        <CalendarIcon className="size-4 mr-2" />
                        {t("addPeriod")}
                    </Button>
                </AddPeriodDialog>
            </div>

            {/* Mobile */}
            <div className="flex gap-2 lg:hidden">
                <AddGradeButton yearId={activeId} />
                <MoreButton yearId={activeId} />
            </div>
        </>
    )
}
