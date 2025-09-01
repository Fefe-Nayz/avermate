"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth";
import { FaGoogle, FaMicrosoft } from "react-icons/fa";
import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { useTranslations } from "next-intl";
import { env } from "@/lib/env";
import { useAccounts } from "@/hooks/use-accounts";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, KeyRoundIcon } from "lucide-react";
import ProfileSection from "../profile-section";
import { Button } from "@/components/ui/button";

const providers = [
  {
    id: "google",
    label: "Google",
    icon: FaGoogle,
  },
  {
    id: "microsoft",
    label: "Microsoft",
    icon: FaMicrosoft,
  },
] satisfies {
  id: "google" | "microsoft";
  label: string;
  icon: React.ComponentType;
}[];

export default function LinkedAccount() {
  const t = useTranslations("Settings.Account.LinkedAccounts");
  const {
    data: accounts,
    isPending,
    isError,
  } = useAccounts();
  const { data: session, isPending: isPendingSession } = authClient.useSession();

  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);

  const linkedProviders = new Set(accounts?.map((acc) => acc.provider));

  async function handleLinkAccount(provider: "google" | "microsoft") {
    try {
      setLinkingProvider(provider);
      await authClient.linkSocial({
        provider,
        callbackURL: `${env.NEXT_PUBLIC_CLIENT_URL}/profile/account`,
      });
    } catch (error) {
      console.error("Error linking account:", error);
    } finally {
      setLinkingProvider(null);
    }
  }

  if (isError) {
    return <div>{ErrorStateCard()}</div>
  }

  if (isPending || isPendingSession)
    return (
      <Card className="p-6 w-full">
        <div className="flex flex-col gap-6">
          <CardHeader className="p-0">
            <CardTitle>
              <Skeleton className="w-36 h-6" />
            </CardTitle>
            <div>
              <Skeleton className="w-20 h-4" />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 border-t text-sm px-2 pt-4">
                <div className="flex gap-2">
                  <Skeleton className="w-20 h-6" />
                </div>
                <div className="flex justify-end"></div>
              </div>

              <div className="mt-4">
                <Skeleton className="w-32 h-6 mb-2" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="w-full h-10" />
                  <Skeleton className="w-full h-10" />
                </div>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    );


  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col ">
        <Separator />
        <div className="flex flex-col divide-y">
          {accounts?.map(({ id, provider }) => (
            <div
              key={id}
              className="flex flex-col gap-2 text-sm px-2 py-4 justify-center"
            >
              <div className="flex gap-2 ">
                <p className="font-semibold capitalize">{provider}</p>
              </div>
            </div>
          ))}
        </div>

        <Separator />

        {/* Add Account Section */}
        <div className="mt-4">
          <h3 className="text-lg font-semibold pb-4">
            {t("linkWithOtherServices")}
          </h3>
          <div className="flex flex-col gap-2">
            {providers
              .filter(({ id }) => !linkedProviders.has(id))
              .map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant="outline"
                  onClick={() => handleLinkAccount(id)}
                  disabled={linkingProvider === id}
                >
                  <Icon className="mr-2" />
                  {linkingProvider === id
                    ? t("linkingWith", { label })
                    : t("link", { label })}
                </Button>
              ))}
            {!accounts.some((acc) => acc.provider === "credential") && (
              <Button variant="outline" asChild>
                <Link href="/auth/forgot-password" className="flex gap-2">
                  <KeyRoundIcon />
                  {t("linkWithPassword")}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </ProfileSection>
  );
}
