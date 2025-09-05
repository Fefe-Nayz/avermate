"use client";
import { UpdateEmailForm } from "@/components/forms/profile/update-email-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth";
import ProfileSection from "./profile-section";
import { useTranslations } from "next-intl";

export default function EmailSection() {
  const t = useTranslations("Settings.Profile.Email");
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <Card className="w-full">
        <div className="flex flex-col gap-6">
          <CardHeader className="pb-0">
            <div>
              <Skeleton className="w-36 h-6" />
            </div>
            <div>
              <Skeleton className="w-20 h-4" />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="flex flex-col gap-4">
              <div className="px-6">
                <form>
                  <div className="w-full">
                    <Skeleton className="w-full h-8" />
                  </div>
                </form>
              </div>
              <div className="flex justify-end border-t py-4 px-6">
                <Button type="submit" disabled={isPending}>
                  {t("save")}
                </Button>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    );
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <UpdateEmailForm defaultEmail={session?.user?.email} />
    </ProfileSection>
  );
}
