"use client";

import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { handleError } from "@/utils/error-utils";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePollingSession } from "@/hooks/use-polling-session";
import { REGEXP_ONLY_DIGITS } from "input-otp";

const VerifyEmailPage = () => {
  const t = useTranslations("Auth.Verify");
  const errorTranslations = useTranslations("Errors");
  const router = useRouter();
  const [otp, setOtp] = useState("");

  const { data: session } = usePollingSession();
  const email = session?.user?.email || "";

  // Verify OTP mutation
  const { mutate: verifyOtp, isPending: isVerifying } = useMutation({
    mutationKey: ["verify-email-otp"],
    mutationFn: async () => {
      const data = await authClient.emailOtp.verifyEmail({
        email,
        otp,
      });
      return data;
    },
    onSuccess: () => {
      router.push("/onboarding");
      toast.success(t("emailVerified"), {
        description: t("emailVerifiedDescription"),
      });
    },
    onError: (error) => {
      setOtp("");
      handleError(error, errorTranslations, t("errorVerifying"));
    },
  });

  // Resend OTP mutation
  const { mutate: resendOtp, isPending: isResending } = useMutation({
    mutationKey: ["resend-otp"],
    mutationFn: async () => {
      await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
    },
    onSuccess: () => {
      toast.success(t("otpResent"), {
        description: t("otpResentDescription", { email }),
      });
    },
    onError: (error) => {
      handleError(error, errorTranslations, t("errorSendingOtp"));
    },
  });

  return (
    <div className="flex flex-col gap-8">
      {/* Title */}
      <div className="flex flex-col gap-2">
        <p className="text-3xl md:text-4xl font-bold">{t("verifyEmail")}</p>
        <div className="flex flex-col gap-0.5 text-sm md:text-base text-muted-foreground">
          <p>{t("otpSent", { email })}</p>
        </div>
      </div>

      {/* OTP Input */}
      <div className="flex flex-col gap-4 items-center">
        <InputOTP
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          value={otp}
          onChange={setOtp}
          disabled={isVerifying}
          onComplete={() => verifyOtp()}
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>

        <Button
          className="w-full"
          onClick={() => verifyOtp()}
          disabled={otp.length !== 6 || isVerifying}
        >
          {isVerifying && <Loader2Icon className="animate-spin mr-2 size-4" />}
          {t("verifyButton")}
        </Button>

        <Button
          className="w-full"
          variant="outline"
          onClick={() => resendOtp()}
          disabled={isResending || !email}
        >
          {isResending && <Loader2Icon className="animate-spin mr-2 size-4" />}
          {t("resendOtp")}
        </Button>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
