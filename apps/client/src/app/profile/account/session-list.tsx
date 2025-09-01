"use client";

import RevokeSessionButton from "@/components/buttons/revoke-session-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card className="p-6 w-full">
        <div className="flex flex-col gap-6">
          <CardHeader className="p-0">
            <CardTitle>
              <Skeleton className="w-36 h-6" />
            </CardTitle>
            <div>
              <Skeleton className="w-32 h-5" />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="flex flex-col gap-6">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 border-t pt-4 w-full"
                >
                  <div className="flex justify-between items-center">
                    <Skeleton className="w-32 h-6" />
                    <Skeleton className="w-20 h-4" />
                  </div>

                  <div className="flex gap-2">
                    <Skeleton className="w-full md:w-64 h-4" />
                  </div>

                  <div className="flex justify-end">
                    <Button variant="destructive" disabled>
                      {t("revoke")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </div>
      </Card>
    );
  }

  if (isError) {
    return <ErrorStateCard />;
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        {sessions?.map((session) => (
          <div
            key={session.id}
            className="flex flex-col gap-2 border-t text-sm px-2 pt-4"
          >
            <div className="flex gap-2 justify-between items-center">
              <div className="flex flex-col md:flex-row gap-1">
                <p className="font-semibold">{session.id.substring(0, 10)}</p>

                <p className="text-muted-foreground">
                  {formatDates.formatRelative(new Date(session.expiresAt))}
                </p>
              </div>

              <span
                className={cn(
                  "items-center px-2 py-1 rounded bg-opacity-30 text-xs border",
                  session.expiresAt < new Date()
                    ? "bg-red-600 text-red-500 border-red-500"
                    : currentSession?.session?.id === session.id
                    ? "bg-green-600 text-green-600 border-green-500"
                    : "bg-blue-600 text-blue-600 border-blue-500"
                )}
              >
                {currentSession?.session?.id === session.id ? (
                  <p>{t("current")}</p>
                ) : session.expiresAt < new Date() ? (
                  <p>{t("expired")}</p>
                ) : (
                  <p>{t("active")}</p>
                )}
              </span>
            </div>

            <div className="flex gap-1 text-muted-foreground">
              {session.userAgent && <p>{session.userAgent}</p>}
              {session.ipAddress && <p>{session.ipAddress}</p>}
            </div>

            <div className="flex justify-end">
              <RevokeSessionButton
                sessionId={session.id}
                sessionToken={session.token}
              />
            </div>
          </div>
        ))}
      </div>
    </ProfileSection>
  );
}
