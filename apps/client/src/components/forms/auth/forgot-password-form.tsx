"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { env } from "@/lib/env";
import { handleError } from "@/utils/error-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import * as z from "zod";

export const ForgotPasswordForm = () => {
  const router = useRouter();
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Auth.Forgot");

  const forgotPasswordSchema = z.object({
    email: z
      .string()
      .email({ message: t("invalidEmail") })
      .max(320, { message: t("emailTooLong") }),
  });

  type ForgotPasswordSchema = z.infer<typeof forgotPasswordSchema>;

  const { mutate, isPending } = useMutation({
    mutationKey: ["sign-up"],
    mutationFn: async ({ email }: ForgotPasswordSchema) => {
      const data = await authClient.requestPasswordReset({
        email,
        redirectTo: `${env.NEXT_PUBLIC_CLIENT_URL}/auth/reset-password`,
      });

      return data;
    },
    onSuccess: (data) => {
      toast.success(t("resetEmailSent"), {
        description: t("checkEmailForInstructions"),
      });
    },

    onError: (error) => {
      handleError(
        error,
        errorTranslations,
        t("errorSendingResetEmail")
      );
    },
  });

  const form = useForm<ForgotPasswordSchema>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = (values: ForgotPasswordSchema) => {
    mutate(values);
  };

  return (
    <div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="email"
            disabled={isPending}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("email")}</FormLabel>

                <FormControl>
                  <Input
                    type="text"
                    placeholder={t("emailPlaceholder")}
                    {...field}
                  />
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />

          <Button className="w-full" type="submit" disabled={isPending}>
            {isPending && <Loader2Icon className="animate-spin mr-2 size-4" />}
            {t("resetPassword")}
          </Button>
        </form>
      </Form>
    </div>
  );
};
