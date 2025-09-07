"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { Average } from "@/types/average";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { handleError } from "@/utils/error-utils";

import { Button } from "../ui/button";
import { Loader2Icon } from "lucide-react";
import { TrashIcon } from "@heroicons/react/24/outline";
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
import { useTranslations } from "next-intl";
import { DropDrawerItem } from "../ui/dropdrawer";

export default function DeleteAverageDialog({ average, averageId, averageName }: { average?: Average, averageId?: string, averageName?: string }) {
  const t = useTranslations("Dashboard.Dialogs.DeleteAverage");
  const errorTranslations = useTranslations("Errors");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { mutate, isPending } = useMutation({
    mutationKey: ["average", "delete", averageId || average?.id],
    mutationFn: async () => {
      const res = await apiClient.delete(`averages/${averageId || average?.id}`);
      const data = await res.json<{ customAverage: Average }>();
      return data.customAverage;
    },
    onSuccess: (deletedAverage) => {
      toast.success(t("successTitle"), {
        description: t("successDescription", { name: deletedAverage.name }),
      });
      setOpen(false);
    },
    onSettled() {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["custom-averages"] });
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
            {t("title", { name: average?.name || averageName || "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("description", { name: average?.name || averageName || "" })}
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
            <AlertDialogAction onClick={handleDelete} disabled={isPending}>
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