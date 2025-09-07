"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { apiClient } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { handleError } from "@/utils/error-utils";

const DeleteAvatar = ({ disabled = false }: { disabled?: boolean }) => {
    const errorTranslations = useTranslations("Errors");
    const t = useTranslations("Settings.Profile.Avatar");
    const router = useRouter();

    const queryClient = useQueryClient();

    const { mutate, isPending } = useMutation({
        mutationKey: ["delete-avatar"],
        mutationFn: async () => {
            const res = await apiClient.delete("users/avatar");
            const data = await res.json();
            return data;
        },
        onSuccess: async () => {
            // Update user profile to remove the avatar
            await authClient.updateUser({ image: null });

            toast.success(t("deleteSuccessTitle"), {
                description: t("deleteSuccessMessage"),
            });

            // Refresh the page to update all avatar instances
            router.refresh();
        },
        onError: (error) => {
            handleError(error, errorTranslations, t("deleteErrorMessage"));
        },
        onSettled: () => {
            queryClient.cancelQueries();
            queryClient.invalidateQueries({ queryKey: ["user-session"] });
        },
    });

    const handleDeleteAvatar = () => {
        mutate();
    };

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    disabled={disabled}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                    <Trash2Icon className="size-4" />
                </Button>
            </AlertDialogTrigger>

            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("deleteAvatarConfirm")}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("deleteAvatarDescription")}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>

                    <Button variant="destructive" disabled={isPending} asChild>
                        <AlertDialogAction
                            disabled={isPending}
                            onClick={handleDeleteAvatar}
                        >
                            {isPending && <Loader2Icon className="animate-spin mr-2 size-4" />}
                            {isPending ? t("deletingAvatar") : t("deleteAvatar")}
                        </AlertDialogAction>
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default DeleteAvatar;
