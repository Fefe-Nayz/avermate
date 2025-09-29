"use client";

import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { Subject } from "@/types/subject";
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

export default function DeleteSubjectDialog({
  subject,
  backOnDelete = true,
}: {
  subject: Subject;
  backOnDelete?: boolean;
}) {
  const t = useTranslations("Dashboard.Dialogs.DeleteSubject");
  const [open, setOpen] = useState(false);

  const router = useRouter();

  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationKey: ["subjects", "delete", subject.id],
    mutationFn: async () => {
      const res = await apiClient.delete(`subjects/${subject.id}`);
      const data = await res.json<{ subject: Subject }>();
      return data.subject;
    },
    onSuccess: (subject) => {
      toast.success(t("successTitle"), {
        description: t("successDescription", { name: subject.name }),
      });

      setOpen(false);

      if (backOnDelete) {
        router.push("/dashboard/grades");
      }
    },
    onSettled: () => {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({
        queryKey: ["subjects", "organized-by-periods"],
      });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
      queryClient.invalidateQueries({ queryKey: ["grades"] });
    },
    onError: (error) => {
      handleError(error, t("error"));
    },
  });

  const handleDelete = () => {
    mutate();
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <DropDrawerItem
          className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4"
          onSelect={(e) => e.preventDefault()}
          variant="destructive"
        >
          <div className="flex items-center w-full text-destructive">
            <TrashIcon className="size-4 mr-2" />
            {t("delete")}
          </div>
        </DropDrawerItem>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("title", { name: subject.name })}
          </AlertDialogTitle>

          <AlertDialogDescription>
            {t("description", { name: subject.name })}
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
