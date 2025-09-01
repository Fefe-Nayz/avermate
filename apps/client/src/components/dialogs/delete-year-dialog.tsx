"use client";

import { useToast } from "@/hooks/use-toast";
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
import { Year } from "@/types/year";
import { useActiveYears } from "@/hooks/use-active-year";
import { useTranslations } from "next-intl";

export default function DeleteYearDialog({
    year,
}: {
    year: Year;
}) {
    const [open, setOpen] = useState(false);

    const { select } = useActiveYears();
    const router = useRouter();
    const toaster = useToast();
    const queryClient = useQueryClient();
    const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.DELETE_YEAR_SECTION");

    const { mutate, isPending } = useMutation({
        mutationKey: ["years", "delete", year.id],
        mutationFn: async () => {
            const res = await apiClient.delete(`years/${year.id}`);
            const data = await res.json<{ year: Year }>();
            return data.year;
        },
        onSuccess: (year) => {
            toaster.toast({
                title: t("DELETE_YEAR_DIALOG_TOAST_SUCCESS_TITLE"),
                description: t("DELETE_YEAR_DIALOG_TOAST_SUCCESS_DESCRIPTION"),
            });

            setOpen(false);

            select("none");
            router.push("/dashboard");
        },
        onSettled: () => {
            queryClient.cancelQueries();
            queryClient.invalidateQueries({ queryKey: ["years"] });
            queryClient.invalidateQueries({ queryKey: ["subjects"] });
            queryClient.invalidateQueries({ queryKey: ["periods"] });
            queryClient.invalidateQueries({ queryKey: ["custom-averages"] });
            queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
            queryClient.invalidateQueries({ queryKey: ["grades"] });
            queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
        },
        onError: (error) => {
            toaster.toast({
                title: t("DELETE_YEAR_DIALOG_TOAST_ERROR_TITLE"),
                description: t("DELETE_YEAR_DIALOG_TOAST_ERROR_DESCRIPTION"),
                variant: "destructive",
            });
        },
    });

    const handleDelete = () => {
        mutate();
    };

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <Button variant="destructive">{t("DELETE_YEAR_DIALOG_OPEN_BUTTON")}</Button>
            </AlertDialogTrigger>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {t("DELETE_YEAR_DIALOG_TITLE")}
                    </AlertDialogTitle>

                    <AlertDialogDescription>
                        {t("DELETE_YEAR_DIALOG_DESCRIPTION")}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <Button variant="outline" asChild>
                        <AlertDialogCancel
                            onClick={() => setOpen(false)}
                            disabled={isPending}
                        >
                            {t("DELETE_YEAR_DIALOG_CANCEL_BUTTON")}
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
                            {t("DELETE_YEAR_DIALOG_DELETE_BUTTON")}
                        </AlertDialogAction>
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
