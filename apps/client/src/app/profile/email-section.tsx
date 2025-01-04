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
import { Session, User } from "better-auth/types";
import ProfileSection from "./profile-section";
import { useTranslations } from "next-intl";

export default function EmailSection() {
  const t = useTranslations("Settings.Profile.Email");
  const { data: session, isPending } = authClient.useSession() as unknown as {
    data: { session: Session; user: User };
    isPending: boolean;
  };

  if (isPending) {
    return (
      <Card className="p-6 w-full">
        <div className="flex flex-col gap-6">
          <CardHeader className="p-0">
            <div>
              <Skeleton className="w-36 h-6" />
            </div>
            <div>
              <Skeleton className="w-20 h-4" />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div>
              <form className="flex flex-col gap-4">
                <div className="w-full">
                  <Skeleton className="w-full h-10" />
                </div>

                <div className="flex w-full justify-end">
                  <Button type="submit" variant="outline" disabled={isPending}>
                    {t("save")}
                  </Button>
                </div>
              </form>
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
