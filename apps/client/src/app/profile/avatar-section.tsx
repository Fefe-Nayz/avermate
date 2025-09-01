"use client";

import Avatar from "@/components/buttons/account/avatar";
import UpdateAvatar from "@/components/buttons/update-avatar";
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

export default function AvatarSection() {
  const t = useTranslations("Settings.Profile.Avatar");
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <Card className={"p-6 w-full"}>
        <div className="flex flex-col gap-6">
          <CardHeader className="p-0">
            <div>
              <Skeleton className="md:w-32 w-full h-6" />
            </div>
            <div>
              <Skeleton className="md:w-64 w-full h-4" />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="flex flex-col md:flex-row items-center  gap-6 align">
              {/* Avatar Skeleton */}
              <div className="min-w-[128px] flex justify-center">
                <Skeleton className="size-32 rounded-full" />
              </div>
              {/* Upload Button Skeleton */}
              <Skeleton className="w-full  h-10 rounded-md" />
            </div>
          </CardContent>
        </div>
      </Card>
    );
  }

  return (
    <ProfileSection
      title={t("title")}
      description={t("description")}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col md:flex-row items-center  gap-6 align">
        <div className="min-w-[128px] flex justify-center">
          <Avatar
            className="size-32"
            size={128}
            src={
              session?.user?.image ||
              `https://avatar.vercel.sh/${session?.user?.id}?size=256`
            }
          />
        </div>
        <UpdateAvatar />
      </div>
    </ProfileSection>
  );
}
