"use client";

import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { Grade, PartialGrade } from "@/types/grade";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { handleError } from "@/utils/error-utils";
import { useTranslations } from "next-intl";
import { DropDrawerItem } from "../ui/dropdrawer";

export default function DeleteGradeDialog({ grade, shouldBackOnDelete = true }: { grade: PartialGrade, shouldBackOnDelete?: boolean }) {
  const t = useTranslations("Dashboard.Dialogs.DeleteGrade");
  const errorTranslations = useTranslations("Errors");
  const [open, setOpen] = useState(false);

  const router = useRouter();

  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationKey: ["grades", "delete", grade.id],
    mutationFn: async () => {
      const res = await apiClient.delete(`grades/${grade.id}`);
      const data = await res.json<{ grade: Grade }>();
      return data.grade;
    },
    onSuccess: (grade) => {
      toast.success(t("successTitle"), {
        description: t("successDescription", { name: grade.name }),
      });

      setOpen(false);

      if (shouldBackOnDelete) {
        router.push("/dashboard/grades");
      }
    },
    onSettled: () => {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
    },
    onError: (error) => {
      handleError(error, errorTranslations, t("error"));
    },
  });

  const handleDelete = () => {
    mutate();
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <DropDrawerItem className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()} variant="destructive">
          <div className="flex items-center w-full text-destructive">
            <TrashIcon className="size-4 mr-2" />
            {t("delete")}
          </div>
        </DropDrawerItem>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("title", { name: grade.name })}
          </AlertDialogTitle>

          <AlertDialogDescription>
            {t("description", { name: grade.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <Button variant="outline" asChild>
            <AlertDialogCancel
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              {t("cancel")}
            </AlertDialogCancel>
          </Button>

          <Button variant="destructive" asChild>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => handleDelete()}
            >
              {isPending && (
                <Loader2Icon className="size-4 mr-2 animate-spin" />
              )}
              {t("delete")}
            </AlertDialogAction>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}