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
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import { handleError } from "@/utils/error-utils";
import { getPasswordStrength } from "@/utils/password";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

export const SignUpForm = () => {
  const [isVisible, setIsVisible] = useState<boolean>(false);

  const router = useRouter();
  const toaster = useToast();
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Auth.SignUp");

  const signUpSchema = z.object({
    firstName: z
      .string()
      .min(2, { message: t("firstNameTooShort") })
      .max(32, { message: t("firstNameTooLong") }),
    lastName: z
      .string()
      .min(2, { message: t("lastNameTooShort") })
      .max(32, { message: t("lastNameTooLong") }),
    password: z
      .string()
      .min(8, { message: t("passwordTooShort") })
      .max(128, { message: t("passwordTooLong") })
      .superRefine((password, ctx) => {
        const strength = getPasswordStrength(password);

        if (strength.strength === "weak") {
          return ctx.addIssue({
            code: "custom",
            message: t("passwordTooWeak"),
          });
        }
      }),
    email: z
      .string()
      .email({ message: t("invalidEmail") })
      .max(320, { message: t("emailTooLong") }),
  });

  type SignUpSchema = z.infer<typeof signUpSchema>;

  const { mutate, isPending } = useMutation({
    mutationKey: ["sign-up"],
    mutationFn: async ({
      firstName,
      lastName,
      email,
      password,
    }: SignUpSchema) => {
      const name = [firstName, lastName].join(" ");

      const data = await authClient.signUp.email({
        name,
        email,
        password,
        callbackURL: `${env.NEXT_PUBLIC_CLIENT_URL}/onboarding`,
      });

      return data;
    },
    onSuccess: (data) => {
      if (!data.user.emailVerified) {
        toaster.toast({
          title: t("emailNotVerified"),
          description: t("verificationLinkSent", { email: data.user.emailVerified }),
        });

        // Redirect to email verify
        router.push("/auth/verify-email");
        return;
      }
    },

    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("signUpError"));
    },
  });

  const toggleVisibility = () => setIsVisible((prevState) => !prevState);

  const form = useForm<SignUpSchema>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      password: "",
      email: "",
    },
  });

  const handleSubmit = (values: SignUpSchema) => {
    mutate(values);
  };

  return (
    <div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex flex-col gap-4"
        >
          <div className="flex gap-4">
            <div className="w-full">
              <FormField
                control={form.control}
                name="firstName"
                disabled={isPending}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("firstName")}</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder={t("firstNamePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="w-full">
              <FormField
                control={form.control}
                name="lastName"
                disabled={isPending}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("lastName")}</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder={t("lastNamePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

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

          <FormField
            control={form.control}
            name="password"
            disabled={isPending}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("password")}</FormLabel>
                <FormControl>
                  <div>
                    {/* Password input field with toggle visibility button */}
                    <div className="space-y-2">
                      <div className="relative">
                        <Input
                          id="password"
                          className="pe-9"
                          placeholder="***********"
                          type={isVisible ? "text" : "password"}
                          {...field}
                        />

                        <button
                          className="absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-lg text-muted-foreground/80 outline-offset-2 transition-colors hover:text-foreground focus:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                          type="button"
                          onClick={toggleVisibility}
                          aria-label={
                            isVisible ? t("hidePassword") : t("showPassword")
                          }
                          aria-pressed={isVisible}
                          aria-controls="password"
                        >
                          {isVisible ? (
                            <EyeOff
                              size={16}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          ) : (
                            <Eye size={16} strokeWidth={2} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Password strength indicator */}
                    <div
                      className="mb-4 mt-3 h-1 w-full overflow-hidden rounded-full bg-border"
                      role="progressbar"
                      aria-valuenow={
                        getPasswordStrength(form.getValues("password")).entropy
                      }
                      aria-valuemin={0}
                      aria-valuemax={4}
                      aria-label={t("passwordStrength")}
                    >
                      <div
                        className={cn(
                          getPasswordStrength(form.getValues("password"))
                            .strength === "weak" && "bg-red-400",
                          getPasswordStrength(form.getValues("password"))
                            .strength === "medium" && "bg-yellow-400",
                          getPasswordStrength(form.getValues("password"))
                            .strength === "strong" && "bg-emerald-500",
                          "h-full transition-all duration-500 ease-out"
                        )}
                        style={{
                          width: `${
                            getPasswordStrength(form.getValues("password"))
                              .entropy * 100
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />

          <Button className="w-full" type="submit" disabled={isPending}>
            {isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
            {t("signUp")}
          </Button>
        </form>
      </Form>
    </div>
  );
};
