"use client";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { handleError } from "@/utils/error-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export function UpdateYearNameForm({
  yearId,
  defaultName,
}: {
  yearId: string;
  defaultName?: string;
}) {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.UPDATE_YEAR_NAME_FORM");
  const queryClient = useQueryClient();

  const schema = z.object({
    name: z
      .string()
      .min(1, { message: t("NAME_MIN_LENGTH_ERROR") })
      .max(32, { message: t("NAME_MAX_LENGTH_ERROR") }),
  });
  type Schema = z.infer<typeof schema>;

  const { mutate, isPending } = useMutation({
    mutationKey: ["update-year-name", yearId],
    mutationFn: async ({ name }: Schema) => {
      const res = await apiClient.patch(`years/${yearId}`, {
        json: { name },
      });
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("TOAST_SUCCESS_TITLE"), {
        description: t("TOAST_SUCCESS_DESC"),
      });
    },
    onSettled: () => {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["years"] });
    },
    onError: (error) => {
      handleError(error, errorTranslations, t("errorMessage", { default: "Update failed" }));
    },
  });

  const form = useForm<Schema>({
    // @ts-ignore
    resolver: zodResolver(schema),
    defaultValues: { name: defaultName ?? "" },
  });

  const onSubmit = (values: Schema) => mutate(values);

  return (
    <div className="flex flex-col gap-4">
      <div className="px-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="w-full">
              <FormField
                control={form.control}
                name="name"
                disabled={isPending}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input type="text" placeholder={defaultName} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </form>
        </Form>
      </div>
      <div className="flex justify-end border-t py-4 px-6">
        <Button type="submit" disabled={isPending} onClick={form.handleSubmit(onSubmit)}>
          {isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
          {t("SUBMIT_BUTTON_LABEL")}
        </Button>
      </div>
    </div>
  );
}

export default UpdateYearNameForm;
