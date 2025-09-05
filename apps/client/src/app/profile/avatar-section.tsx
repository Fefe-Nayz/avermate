"use client";

import Avatar from "@/components/buttons/account/avatar";
import UpdateAvatar from "@/components/buttons/update-avatar";
import DeleteAvatar from "@/components/buttons/delete-avatar";
import { Trash2Icon } from "lucide-react";
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
import { Button } from "@/components/ui/button";

export default function AvatarSection() {
  const t = useTranslations("Settings.Profile.Avatar");
  const { data: session, isPending } = authClient.useSession();

  // Check if user has a custom avatar (not the default Vercel avatar)
  const hasCustomAvatar = session?.user?.image && !session.user.image.includes("avatar.vercel.sh");

  if (isPending) {
    return (
      <Card className="flex flex-col gap-6">
        <div className="flex justify-between">
          <CardHeader className="pb-0 grow self-start">
            <CardTitle>
              <Skeleton className="w-full md:w-32 h-6" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="w-full md:w-64 h-4" />
            </CardDescription>
          </CardHeader>
          <div className="me-6 rounded-full pt-6">
            <Skeleton className="size-20 rounded-full" />
          </div>
        </div>
        <div className="flex flex-col justify-between items-center gap-4 rounded-b-xl md:flex-row border-t bg-muted dark:bg-transparent py-5 px-6">
          <div className="text-center text-muted-foreground text-xs md:text-start md:text-sm">
            <Skeleton className="w-full md:w-48 h-4" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending}>
              {t("changeAvatar")}
            </Button>
            <Button variant="outline"
              size="icon"
              className="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={isPending}>
              <Trash2Icon className="size-4 " />
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-card text-card-foreground flex flex-col gap-6 rounded-xl border shadow-sm w-full pb-0 text-start">
      <div className="flex justify-between">
        <CardHeader className="pb-0 grow self-start">
          <CardTitle className="font-semibold">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("description")}
          </CardDescription>
        </CardHeader>
        <div className="me-6 rounded-full pt-6">
          <Avatar
            size={80}
            src={
              session?.user?.image ||
              `https://avatar.vercel.sh/${session?.user?.id}?size=160`
            }
          />
        </div>
      </div>
      <div className="flex flex-col justify-between items-center gap-4 rounded-b-xl md:flex-row border-t bg-muted dark:bg-transparent py-5 px-6">
        <div className="text-center text-muted-foreground text-xs md:text-start md:text-sm">
          {t("allowedFormats")}
        </div>
        <div className="flex gap-2">
          <UpdateAvatar />
          <DeleteAvatar disabled={!hasCustomAvatar} />
        </div>
      </div>
    </Card>
  );
}
