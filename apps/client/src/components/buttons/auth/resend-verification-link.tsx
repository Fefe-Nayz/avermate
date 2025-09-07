"use client";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { env } from "@/lib/env";
import { handleError } from "@/utils/error-utils";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

const ResendVerificationLink = ({ email }: { email: string }) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Auth.Verify");

  const { mutate, isPending } = useMutation({
    mutationKey: ["verify-email"],
    mutationFn: async () => {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: `${env.NEXT_PUBLIC_CLIENT_URL}/onboarding`,
      });
    },
    onSuccess: () => {
      toast.success(t("linkResent"), {
        description: t("linkResentDescription", { email }),
      });
    },
    onError: (error) => {
      handleError(error, errorTranslations, t("errorSendingLink"));
    },
  });

  return (
    <Button
      variant="outline"
      disabled={email === "" || isPending}
      onClick={() => mutate()}
    >
      {isPending && <Loader2Icon className="animate-spin" />}
      {t("resendVerificationLink")}
    </Button>
  );
};

export default ResendVerificationLink;
