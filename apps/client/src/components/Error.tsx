// components/Error.tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { handleError } from "@/utils/error-utils";
import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth";
import { User } from "better-auth/types";
import { Session } from "inspector";

interface ErrorProps {
  errorMessage?: string;
  reset?: () => void;
  errorStack?: string;
}

export default function ErrorComponent({
  errorMessage,
  reset,
  errorStack,
}: ErrorProps) {
  const errorTranslation = useTranslations("ErrorPages.Error");
  const t = useTranslations("ErrorPages.Error");

  const hasSentRef = useRef(false);

  const { data: session } = authClient.useSession();

  const { mutate, isPending } = useMutation({
    mutationKey: ["send-error-report"],
    mutationFn: async () => {
      const userAgent = navigator.userAgent;
      const currentUrl = window.location.href;
      const referrer = document.referrer;
      const timestamp = new Date().toISOString();
      const screenResolution = `${window.screen.width}x${window.screen.height}`;
      const viewport = `${window.innerWidth}x${window.innerHeight}`;
      const platform = navigator.platform;
      const language = navigator.language;

      const errorContent = `
Error Details:
-------------
Error Message: ${errorMessage}
Timestamp: ${timestamp}

User Environment:
---------------
Browser: ${userAgent}
Platform: ${platform}
Language: ${language}
Screen Resolution: ${screenResolution}
Viewport Size: ${viewport}

Navigation:
----------
Current URL: ${currentUrl} 
Referrer: ${referrer}

User Info:
---------
User Name: ${session?.user?.name || "Not logged in"}
`;

      await apiClient.post("feedback", {
        json: {
          type: "Bug",
          subject: "Automatic user error: " + errorMessage,
          content: errorContent.toString(),
          email: session?.user?.email,
          errorStack: errorStack,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("errorReportSentTitle"), {
        description: t("errorReportSentDescription"),
      });
    },
    onError: (error) => {
      handleError(error, errorTranslation, ("errorSubmittingReport"));
    },
  });

  useEffect(() => {
    if (!hasSentRef.current) {
      mutate();
      hasSentRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen w-full flex items-center justify-center bg-background">
      <div className="absolute top-4 left-6">
        <Link className="flex gap-4 items-center " href="/">
          <img className="size-8 rounded-lg" src="/logo.svg" alt="Logo" />
          Avermate
        </Link>
      </div>
      <Card className="w-full max-w-md border-none shadow-lg">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center">
            {"Error"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-lg mb-4">{t("title")}</p>
          <p className="text-muted-foreground">
            {t("description", { statusCode: errorMessage || "" })}
          </p>
        </CardContent>
        <CardFooter className="flex flex-col items-center space-y-2">
          {/* //display the stackTrace main error */}
          {/* <pre className="mt-4 text-left bg-muted p-2 rounded overflow-auto max-h-[500px] max-w-[200%] text-sm-500 mb-4">
                      {errorStack}
                  </pre> */}

          <Button asChild>
            <Link href="/">{t("backToHome")}</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
