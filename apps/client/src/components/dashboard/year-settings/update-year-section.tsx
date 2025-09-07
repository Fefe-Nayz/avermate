"use client";

import ProfileSection from '@/app/profile/profile-section'
import UpdateYearDateRangeForm from '@/components/forms/years/update-year-daterange'
import UpdateYearDefaultOutOfForm from '@/components/forms/years/update-year-default-out-out'
import UpdateYearNameForm from '@/components/forms/years/update-year-name-form'
import { useYears } from '@/hooks/use-years';
import React from 'react'

export default function UpdateYearSection({ yearId }: { yearId: string }) {

  const { data, isPending, isError } = useYears();
  const year = data?.find((year) => year.id === yearId);

  if (!year) return null;

  return (
    <div className="flex flex-col gap-4 md:gap-8">
      <ProfileSection title="UPDATE_YEAR_SECTION_NAME_SECTION_TITLE" description="UPDATE_YEAR_SECTION_NAME_SECTION_DESCRIPTION">
        <UpdateYearNameForm yearId={yearId} defaultName={year.name} />
      </ProfileSection>

      <ProfileSection title="UPDATE_YEAR_SECTION_NAME_SECTION_TITLE" description="UPDATE_YEAR_SECTION_NAME_SECTION_DESCRIPTION">
        <UpdateYearDefaultOutOfForm yearId={yearId} defaultOutOf={year.defaultOutOf} />
      </ProfileSection>

      <ProfileSection title="UPDATE_YEAR_SECTION_NAME_SECTION_TITLE" description="UPDATE_YEAR_SECTION_NAME_SECTION_DESCRIPTION">
        <UpdateYearDateRangeForm yearId={yearId} defaultFrom={new Date(year.startDate)} defaultTo={new Date(year.endDate)} />
      </ProfileSection>
    </div>
  )
}
