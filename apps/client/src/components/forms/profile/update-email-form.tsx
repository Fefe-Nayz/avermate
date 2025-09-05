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
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth";
import { env } from "@/lib/env";
import { handleError } from "@/utils/error-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

export const UpdateEmailForm = ({
  defaultEmail,
}: {
  defaultEmail?: string;
}) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Settings.Profile.Email");
  const toaster = useToast();

  const updateEmailSchema = z.object({
    email: z
      .string()
      .min(1, { message: t("emailMinLength") })
      .max(64, { message: t("emailMaxLength") })
      .email({ message: t("invalidEmail") }),
  });

  type UpdateEmailSchema = z.infer<typeof updateEmailSchema>;

  const { mutate, isPending } = useMutation({
    mutationKey: ["update-email"],
    mutationFn: async ({ email }: UpdateEmailSchema) => {
      const data = await authClient.changeEmail({
        newEmail: email,
        callbackURL: env.NEXT_PUBLIC_CLIENT_URL + "/profile",
      });
      return { data, newEmail: email };
    },
    onSuccess: ({ data, newEmail }) => {
      // Send toast notification
      toaster.toast({
        title: t("successTitle"),
        description: t("successMessage", { email: newEmail }),
      });
    },

    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("errorMessage"));
    },
  });

  const form = useForm({
    // @ts-ignore
    resolver: zodResolver(updateEmailSchema),
    defaultValues: {
      email: defaultEmail,
    },
  });

  const handleSubmit = (values: UpdateEmailSchema) => {
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
                name="email"
                disabled={isPending}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input type="text" placeholder={defaultEmail} {...field} />
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
