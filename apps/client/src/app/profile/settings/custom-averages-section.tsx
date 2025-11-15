"use client";

import AddAverageDialog from "@/components/dialogs/add-average-dialog";
import DeleteAverageDialog from "@/components/dialogs/delete-average-dialog";
import UpdateAverageDialog from "@/components/dialogs/update-average-dialog";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useSubjects } from "@/hooks/use-subjects";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { PlusCircleIcon } from "lucide-react";
import ProfileSection from "../profile-section";
import { CustomAverageEmptyState } from "@/components/empty-states/custom-average-empty-state";
import { useTranslations } from "next-intl";
import { useCustomAverages } from "@/hooks/use-custom-averages";
import {
  DropDrawer,
  DropDrawerTrigger,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerGroup,
} from "@/components/ui/dropdrawer";

export const CustomAveragesSection = ({ yearId }: { yearId: string }) => {
  const t = useTranslations("Settings.Settings.CustomAverages");

  const {
    data: averages,
    isError: isAveragesError,
    isPending: isAveragesPending,
  } = useCustomAverages(yearId);

  const {
    data: subjects,
    isError: isSubjectsError,
    isPending: isSubjectsPending,
  } = useSubjects(yearId);

  if (isAveragesPending || isSubjectsPending) {
    return (
      <Card className={"w-full"}>
        <div className="flex flex-col gap-6">
          <CardHeader className="pb-0">
            <CardTitle>
              <Skeleton className="w-36 h-6" />
            </CardTitle>
            <div>
              <Skeleton className="w-20 h-4" />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="flex flex-col gap-4">
              <div className="px-6 grid gap-4">
                {Array.from({ length: 1 }).map((_, index) => (
                  <div
                    key={index}
                    className="bg-card text-card-foreground flex gap-6 rounded-xl border shadow-sm flex-row p-4 justify-between items-start"
                  >
                    <div className="flex flex-col gap-1 w-full">
                      <Label>
                        <Skeleton className="w-full md:w-64 h-6" />
                      </Label>
                      <span className="text-muted-foreground text-sm">
                        <Skeleton className="w-full md:w-32 h-4" />
                      </span>
                    </div>
                    <div>
                      <Button size="icon" variant="outline" disabled>
                        <EllipsisVerticalIcon className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end border-t py-4 px-6">
                <AddAverageDialog yearId={yearId}>
                  <Button disabled>
                    <PlusCircleIcon className="size-4" />
                    {t("addCustomAverage")}
                  </Button>
                </AddAverageDialog>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    );
  }

  if (isAveragesError || isSubjectsError) {
    return <div>{<ErrorStateCard />}</div>;
  }

  if (averages.length == 0) {
    return (
      <ProfileSection title={t("title")} description={t("description")}>
        <CustomAverageEmptyState yearId={yearId} className="mx-6 mb-6" />
      </ProfileSection>
    );
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <div className="px-6 grid gap-4">
          {averages?.map((average) => (
            <div
              key={average.id}
              className="bg-card text-card-foreground flex gap-6 rounded-xl border shadow-sm flex-row p-4 justify-between items-center"
            >
              <div className="flex flex-col gap-1">
                <Label>{average.name}</Label>
                <span className="text-muted-foreground text-sm">
                  {average.subjects
                    .map(
                      (subjectId) =>
                        subjects?.find((subject) => subject.id === subjectId.id)
                          ?.name
                    )
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
              <div>
                <DropDrawer>
                  <DropDrawerTrigger asChild>
                    <Button size="icon" variant="outline">
                      <EllipsisVerticalIcon className="size-4" />
                    </Button>
                  </DropDrawerTrigger>

                  <DropDrawerContent>
                    <DropDrawerGroup>
                      {/* Update grade */}
                      <UpdateAverageDialog averageId={average.id} />

                      {/* Delete grade */}
                      <DeleteAverageDialog average={average} />
                    </DropDrawerGroup>
                  </DropDrawerContent>
                </DropDrawer>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t py-4 px-6">
          <AddAverageDialog yearId={yearId}>
            <Button>
              <PlusCircleIcon className="size-4" />
              {t("addCustomAverage")}
            </Button>
          </AddAverageDialog>
        </div>
      </div>
    </ProfileSection>
  );
};
