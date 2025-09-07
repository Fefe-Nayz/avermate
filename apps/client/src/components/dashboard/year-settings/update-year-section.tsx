"use client";

import ProfileSection from '@/app/profile/profile-section'
import UpdateYearDateRangeForm from '@/components/forms/years/update-year-daterange'
import UpdateYearDefaultOutOfForm from '@/components/forms/years/update-year-default-out-out'
import UpdateYearNameForm from '@/components/forms/years/update-year-name-form'
import { useYears } from '@/hooks/use-years';
import { useTranslations } from 'next-intl';
import React from 'react'

export default function UpdateYearSection({ yearId }: { yearId: string }) {
  const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.UPDATE_YEAR_SECTION");

  const { data, isPending, isError } = useYears();
  const year = data?.find((year) => year.id === yearId);

  if (!year) return null;

  return (
    <div className="flex flex-col gap-4 md:gap-8">
      <ProfileSection title={t("UPDATE_YEAR_NAME_SECTION_TITLE")} description={t("UPDATE_YEAR_NAME_SECTION_DESCRIPTION")}>
        <UpdateYearNameForm yearId={yearId} defaultName={year.name} />
      </ProfileSection>

      <ProfileSection title={t("UPDATE_YEAR_DEFAULT_OUT_OF_SECTION_TITLE")} description={t("UPDATE_YEAR_DEFAULT_OUT_OF_SECTION_DESCRIPTION")}>
        <UpdateYearDefaultOutOfForm yearId={yearId} defaultOutOf={year.defaultOutOf} />
      </ProfileSection>

      <ProfileSection title={t("UPDATE_YEAR_DATE_RANGE_SECTION_TITLE")} description={t("UPDATE_YEAR_DATE_RANGE_SECTION_DESCRIPTION")}>
        <UpdateYearDateRangeForm yearId={yearId} defaultFrom={new Date(year.startDate)} defaultTo={new Date(year.endDate)} />
      </ProfileSection>
    </div>
  )
}
