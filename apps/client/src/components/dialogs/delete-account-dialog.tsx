"use client";

import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth";
import { QueryClient, useMutation } from "@tanstack/react-query";
import { User } from "better-auth/types";
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

export default function DeleteAccountDialog() {
  const t = useTranslations("Settings.Account.DeleteAccount");
  const errorTranslations = useTranslations("Errors");
  const [open, setOpen] = useState(false);

  const router = useRouter();

  const toaster = useToast();

  const queryClient = new QueryClient();

  const { data: session } = authClient.useSession();

  const { mutate, isPending } = useMutation({
    mutationKey: ["users", "delete", session?.user?.id],
    mutationFn: async () => {
      const { message, success } = await authClient.deleteUser();
      return { message, success };
    },
    onSuccess: () => {
      toaster.toast({
        title: t("successTitle"),
        description: t("successMessage"),
      });

      setOpen(false);

      router.push("/");

      queryClient.cancelQueries();
      queryClient.clear();
      queryClient.invalidateQueries();
      queryClient.cancelQueries();

      localStorage.clear();
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("errorMessage"));
    },
  });

  const handleDelete = () => {
    mutate();
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">{t("triggerButton")}</Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("titleDialog")}</AlertDialogTitle>

          <AlertDialogDescription>
            {t("descriptionDialog")}
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
