"use client";

import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
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

export default function RevokeSessionButton({
  sessionId,
  sessionToken,
  isCurrent = false,
}: {
  sessionId: string;
  sessionToken: string;
  isCurrent?: boolean;
}) {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Settings.Account.SessionList");

  const toaster = useToast();
  const router = useRouter();

  const { data: currentSession } = authClient.useSession();

  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationKey: ["revoke-session"],
    mutationFn: async () => {
      const data = await authClient.revokeSession({
        token: sessionToken,
      });
      return data;
    },
    onSuccess: () => {
      // Send a notification toast
      toaster.toast({
        title: t("successTitle"),
        description: t("successMessage"),
      });

      if (sessionId === currentSession?.session?.id) {
        router.push("/");
      }
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("errorMessage"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions-list"] });
    },
  });

  function handleRevokeSession() {
    mutate();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {isCurrent ? (
          <Button variant="outline">{t("signoutDialog")}</Button>
        ) : (
          <Button variant="outline">{t("revokeDialog")}</Button>
        )}
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isCurrent ? t("signoutTitleDialog") : t("titleDialog")}</AlertDialogTitle>
          <AlertDialogDescription>
            { isCurrent ? t("signoutDescriptionDialog") : t("descriptionDialog")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>

          <Button variant="destructive" disabled={isPending} asChild>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => handleRevokeSession()}
            >
              {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {isCurrent ? t("signoutSession") : t("revokeSession")}
            </AlertDialogAction>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
