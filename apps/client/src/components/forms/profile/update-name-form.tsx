"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { handleError } from "@/utils/error-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

export const UpdateNameForm = ({ defaultName }: { defaultName: string }) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Settings.Profile.Name");
  const updateNameSchema = z.object({
    name: z
      .string()
      .min(1, { message: t("nameMinLength") })
      .max(64, { message: t("nameMaxLength") }),
  });

  type UpdateNameSchema = z.infer<typeof updateNameSchema>;

  const { mutate, isPending } = useMutation({
    mutationKey: ["update-name"],
    mutationFn: async ({ name }: UpdateNameSchema) => {
      const data = await authClient.updateUser({
        name,
      });
      return data;
    },
    onSuccess: () => {
      // Send a notification toast
      toast.success(t("successTitle"), {
        description: t("successMessage"),
      });
    },

    onError: (error) => {
      handleError(error, errorTranslations, t("errorMessage"));
    },
  });

  const form = useForm({
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    resolver: zodResolver(updateNameSchema),
    defaultValues: {
      name: defaultName,
    },
  });

  const handleSubmit = (values: UpdateNameSchema) => {
    mutate(values);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="px-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
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
        <Button
          type="submit"
          disabled={isPending}
          onClick={form.handleSubmit(handleSubmit)}
        >
          {isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
};
