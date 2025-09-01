"use client";

import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth";
import { useMutation } from "@tanstack/react-query";
import { LogOutIcon } from "lucide-react";
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
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { useTranslations } from "next-intl";

export default function SignOutButton() {
  const router = useRouter();
  const toaster = useToast();
  const t = useTranslations("Header.Dropdown");

  const { mutate, isPending } = useMutation({
    mutationKey: ["sign-out"],
    mutationFn: async () => {
      localStorage.setItem("isSigningOut", "true");
      const data = await authClient.signOut();
    },
    onSuccess: () => {
      localStorage.removeItem("isOnboardingCompleted");
      localStorage.removeItem("selectedTab");

      router.push("/auth/sign-in");

      toaster.toast({
        title: t("signedOut"),
        description: t("seeYouSoon"),
      });

      setTimeout(() => {
        localStorage.removeItem("isSigningOut");
      }, 1000);
    },
  });

  const handleSignOut = (e: any) => {
    e.preventDefault();
    mutate();
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <DropdownMenuItem
          className="text-red-500!"
          onSelect={(e) => e.preventDefault()}
        >
          <LogOutIcon className="size-4 mr-2" />
          {t("signOut")}
        </DropdownMenuItem>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("signOut")}</AlertDialogTitle>
          <AlertDialogDescription>{t("confirmSignOut")}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {t("stay")}
          </AlertDialogCancel>

          <Button variant="destructive" asChild>
            <AlertDialogAction disabled={isPending} onClick={handleSignOut}>
              {t("signOut")}
            </AlertDialogAction>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
