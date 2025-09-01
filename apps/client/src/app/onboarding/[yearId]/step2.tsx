import AddSubjectDialog from "@/components/dialogs/add-subject-dialog";
import DeleteSubjectDialog from "@/components/dialogs/delete-subject-dialog";
import ListPresetsDialog from "@/components/dialogs/list-presets-dialog";
import UpdateSubjectDialog from "@/components/dialogs/update-subject-dialog";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSubjects } from "@/hooks/use-subjects";
import { Subject } from "@/types/subject";
import {
  EllipsisVerticalIcon,
  PlusCircleIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";

export default function Step2({yearId}: {yearId: string}) {
  const t = useTranslations("Onboarding.Step2");
  const { data: subjects, isError, isLoading } = useSubjects(yearId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
        <div className="flex flex-col gap-4">
          {Array.from({ length: 20 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-4"
            >
              <div className="flex items-center flex-1 gap-2">
                <Skeleton className="w-1/2 h-5" />
              </div>
              <div className="flex space-x-2">
                <Button size="icon" variant="outline" disabled>
                  <PlusCircleIcon className="size-4" />
                </Button>
                <Button size="icon" variant="outline" disabled>
                  <EllipsisVerticalIcon className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex md:flex-row flex-col items-center justify-center md:space-x-4 space-x-0 gap-2 md:gap-0">
          <AddSubjectDialog yearId={yearId}>
            <Button variant="outline" disabled>
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addSubject")}
            </Button>
          </AddSubjectDialog>
          <ListPresetsDialog yearId={yearId}>
            <Button disabled>
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addPresetSubjects")}
            </Button>
          </ListPresetsDialog>
        </div>
      </div>
    );
  }

  if (isError) {
    return ErrorStateCard();
  }

  if (!subjects || subjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center space-y-8">
        <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
        <p className="text-muted-foreground text-center">
          <ul>
            <li>
              {t.rich("mainSubjectsDescription", {
                b: (chunks) => <b>{chunks}</b>,
              })}
            </li>
            <li>
              {t.rich("categoriesDescription", {
                b: (chunks) => <b>{chunks}</b>,
              })}
            </li>
            <li>
              {t.rich("subSubjectsDescription", {
                b: (chunks) => <b>{chunks}</b>,
              })}
            </li>
          </ul>
        </p>
        <div className="flex md:flex-row flex-col items-center justify-center md:space-x-4 space-x-0 gap-2 md:gap-0">
          <AddSubjectDialog yearId={yearId}>
            <Button variant="outline">
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addSubject")}
            </Button>
          </AddSubjectDialog>
          <ListPresetsDialog yearId={yearId}>
            <Button>
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addPresetSubjects")}
            </Button>
          </ListPresetsDialog>
        </div>
      </div>
    );
  }

  const renderSubjects = (
    subjects: Subject[],
    parentId: string | null = null,
    level: number = 0
  ) =>
    subjects
      .filter((subject: Subject) => subject.parentId === parentId)
      .map((subject: Subject) => (
        <div
          key={subject.id}
          className={`${
            level > 0 ? "border-l-2 border-gray-300 pl-2 md:pl-4 " : ""
          }`}
        >
          <div className="flex md:flex-row md:items-center justify-between min-w-0 pb-4 gap-4">
            <div className="flex items-center space-x-2  flex-1 min-w-0">
              <span className="font-bold truncate">{subject.name}</span>
              {!subject.isDisplaySubject && (
                <span className="text-sm text-muted-foreground">
                  ({subject.coefficient / 100})
                </span>
              )}
              {subject.isMainSubject && (
                <>
                  <span className="hidden md:block text-xs text-blue-500">
                    {t("mainSubject")}
                  </span>
                  <Badge className="bg-blue-500 block md:hidden py-0 px-0 w-2 h-2 min-w-2" />
                </>
              )}
              {subject.isDisplaySubject && (
                <>
                  <span className="hidden md:block text-xs text-green-500">
                    {t("category")}
                  </span>
                  <Badge className="bg-green-500 block md:hidden py-0 px-0 w-2 h-2 min-w-2" />
                </>
              )}
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <AddSubjectDialog yearId={yearId} parentId={subject.id}>
                <Button variant="outline" size="icon">
                  <PlusCircleIcon className="size-4" />
                </Button>
              </AddSubjectDialog>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="outline">
                    <EllipsisVerticalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem asChild>
                    <UpdateSubjectDialog subjectId={subject.id} />
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <DeleteSubjectDialog
                      subject={subject}
                      backOnDelete={false}
                    />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {renderSubjects(subjects, subject.id, level + 1)}
        </div>
      ));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
      <div>{renderSubjects(subjects ?? [])}</div>
      <div className="flex flex-col items-center justify-center space-y-4">
        <AddSubjectDialog yearId={yearId}>
          <Button variant="outline">
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addNewSubject")}
          </Button>
        </AddSubjectDialog>
      </div>
    </div>
  );
}
