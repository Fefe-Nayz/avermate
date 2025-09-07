"use client";

import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { Period } from "@/types/period";
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

export default function DeletePeriodDialog({ period }: { period: Period }) {
  const t = useTranslations("Dashboard.Dialogs.DeletePeriod");
  const errorTranslations = useTranslations("Errors");
  const [open, setOpen] = useState(false);

  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationKey: ["periods", "delete", period.id],
    mutationFn: async () => {
      const res = await apiClient.delete(`periods/${period.id}`);
      const data = await res.json<{ period: Period }>();
      return data.period;
    },
    onSuccess: (period) => {
      toast.success(t("successTitle"), {
        description: t("successDescription", { name: period.name }),
      });

      setOpen(false);
    },
    onSettled: () => {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["periods"] });
      queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
      queryClient.invalidateQueries({ queryKey: ["grades"] });
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
            {t("title", { name: period.name })}
          </AlertDialogTitle>

          <AlertDialogDescription>
            {t("description", { name: period.name })}
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