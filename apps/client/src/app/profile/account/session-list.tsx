"use client";

import RevokeSessionButton from "@/components/buttons/revoke-session-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import ProfileSection from "../profile-section";
import ErrorStateCard from "@/components/skeleton/error-card";
import "dayjs/locale/fr";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import { useSessions } from "@/hooks/use-sessions";
import { UAParser } from "ua-parser-js";
import { LaptopIcon, SmartphoneIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

dayjs.locale("fr");
dayjs.extend(relativeTime);

// type Session = {
//   id: string;
//   userId: string;
//   createdAt: Date;
//   updatedAt: Date;
//   expiresAt: Date;
//   token: string;
//   ipAddress?: string | null | undefined;
//   userAgent?: string | null | undefined;
// };

export default function SessionList() {
  const formatter = useFormatter();
  const t = useTranslations("Settings.Account.SessionList");
  const formatDates = useFormatDates(formatter);

  const { data: currentSession } = authClient.useSession();

  const {
    data: sessions,
    isError,
    isPending,
  } = useSessions();

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="w-36 h-5" />
          </CardTitle>
          <div>
            <Skeleton className="w-32 h-4" />
          </div>
        </CardHeader>

        <CardContent className="px-6 grid gap-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="bg-card text-card-foreground flex rounded-xl border shadow-sm flex-row items-center gap-3 px-4 py-3"
            >
              <Skeleton className="size-4" />
              <div className="flex flex-col flex-1">
                <Skeleton className="w-32 h-5 mb-1" />
                <Skeleton className="w-48 h-3" />
              </div>
              <Button variant="outline" disabled >
                {t("revoke")}
              </Button>
            </div>
          ))}
        </CardContent>
        <div className="items-center px-6 [.border-t]:pt-6 flex flex-col justify-between gap-4 rounded-b-xl md:flex-row bg-muted dark:bg-transparent"></div>
      </Card>
    );
  }

  if (isError) {
    return <ErrorStateCard />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("title")}
        </CardTitle>
        <CardDescription>
          {t("description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {sessions?.map((session) => (
            <div
              key={session.id}
              className="bg-card text-card-foreground flex rounded-xl border shadow-sm flex-row items-center gap-3 px-4 py-3"
            >
              {(() => {
                const parser = UAParser(session.userAgent as string);
                return (parser.device.type === "mobile" || parser.device.type === "tablet") ?
                  <SmartphoneIcon className="size-4" /> :
                  <LaptopIcon className="size-4" />;
              })()}
              <div className="flex flex-col flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    {currentSession?.session?.id === session.id
                      ? t("currentSession")
                      : (session.ipAddress || "127.0.0.1")}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs font-medium",
                      currentSession?.session?.id === session.id
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300"
                        : session.expiresAt < new Date()
                          ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-300"
                          : "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300"
                    )}
                  >
                    {currentSession?.session?.id === session.id
                      ? t("current")
                      : session.expiresAt < new Date()
                        ? t("expired")
                        : t("active")}
                  </Badge>
                  {session.expiresAt > new Date() && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      {t("expire")} {formatDates.formatRelative(new Date(session.expiresAt))}
                    </Badge>
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {session.userAgent && (
                    <span>
                      {(() => {
                        const parser = UAParser(session.userAgent as string);
                        return `${parser.os.name}, ${parser.browser.name}`;
                      })()}
                    </span>
                  )}
                  {session.ipAddress && <span>, {session.ipAddress}</span>}
                </span>
              </div>
              <div className="ms-auto">
                <RevokeSessionButton
                  sessionId={session.id}
                  sessionToken={session.token}
                  isCurrent={currentSession?.session?.id === session.id}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <div className="items-center px-6 [.border-t]:pt-6 flex flex-col justify-between gap-4 rounded-b-xl md:flex-row bg-muted dark:bg-transparent"></div>
    </Card>
  );
}
