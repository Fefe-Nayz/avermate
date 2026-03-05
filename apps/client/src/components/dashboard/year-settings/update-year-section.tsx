"use client";

import ProfileSection from "@/app/profile/profile-section";
import UpdateYearDateRangeForm from "@/components/forms/years/update-year-daterange";
import UpdateYearDefaultOutOfForm from "@/components/forms/years/update-year-default-out-out";
import UpdateYearNameForm from "@/components/forms/years/update-year-name-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useYears } from "@/hooks/use-years";
import { useTranslations } from "next-intl";

function YearSettingCardSkeleton() {
  return (
    <Card className="w-full">
      <div className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-48" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-64" />
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <div className="flex flex-col gap-4">
            <div className="px-6">
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="flex justify-end border-t px-6 pt-6 pb-0">
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

export default function UpdateYearSection({ yearId }: { yearId: string }) {
  const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.UPDATE_YEAR_SECTION");

  const { data, isPending } = useYears();
  const year = data?.find((currentYear) => currentYear.id === yearId);

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 md:gap-8">
        <YearSettingCardSkeleton />
        <YearSettingCardSkeleton />
        <YearSettingCardSkeleton />
      </div>
    );
  }

  if (!year) return null;

  return (
    <div className="flex flex-col gap-4 md:gap-8">
      <ProfileSection
        title={t("UPDATE_YEAR_NAME_SECTION_TITLE")}
        description={t("UPDATE_YEAR_NAME_SECTION_DESCRIPTION")}
      >
        <UpdateYearNameForm yearId={yearId} defaultName={year.name} />
      </ProfileSection>

      <ProfileSection
        title={t("UPDATE_YEAR_DEFAULT_OUT_OF_SECTION_TITLE")}
        description={t("UPDATE_YEAR_DEFAULT_OUT_OF_SECTION_DESCRIPTION")}
      >
        <UpdateYearDefaultOutOfForm
          yearId={yearId}
          defaultOutOf={year.defaultOutOf}
        />
      </ProfileSection>

      <ProfileSection
        title={t("UPDATE_YEAR_DATE_RANGE_SECTION_TITLE")}
        description={t("UPDATE_YEAR_DATE_RANGE_SECTION_DESCRIPTION")}
      >
        <UpdateYearDateRangeForm
          yearId={yearId}
          defaultFrom={new Date(year.startDate)}
          defaultTo={new Date(year.endDate)}
        />
      </ProfileSection>
    </div>
  );
}