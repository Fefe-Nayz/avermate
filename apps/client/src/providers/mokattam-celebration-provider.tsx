"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flame, HeartHandshake, Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Confetti, type ConfettiRef } from "@/components/magicui/confetti";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUserSettings } from "@/hooks/use-user-settings";
import { apiClient } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-keys";
import {
  readLocalUserSettings,
  resolveUpdatedAt,
  updateLocalUserSettings,
  writeLocalUserSettings,
} from "@/lib/user-settings-storage";
import { toast } from "@/lib/toast";
import type { PersistedUserSettings } from "@/types/user-settings";

type UserSettingsResponse = {
  settings: PersistedUserSettings;
};

const MOKATTAM_CONFETTI_COLORS = [
  "#ea580c",
  "#f97316",
  "#fb923c",
  "#fdba74",
  "#fed7aa",
  "#fff7ed",
];
const MOKATTAM_CONFETTI_ORIGIN = { x: 0.5, y: 0.38 };

function applyPersistedSettings(settings: PersistedUserSettings) {
  writeLocalUserSettings(settings, resolveUpdatedAt(settings.updatedAt));
}

export default function MokattamCelebrationProvider() {
  const t = useTranslations("Settings.Settings.MokattamTheme");
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const { data: remoteSettings } = useUserSettings(Boolean(userId));
  const confettiRef = useRef<ConfettiRef>(null);
  const lastCelebrationKeyRef = useRef<string | null>(null);
  const confettiTimeoutsRef = useRef<number[]>([]);
  const [open, setOpen] = useState(false);

  const syncCachedSettings = (settings: PersistedUserSettings) => {
    queryClient.setQueryData(queryKeys.userSettings.current, settings);
    applyPersistedSettings(settings);
  };

  const acknowledgeCelebrationMutation = useMutation({
    mutationKey: ["settings", "mokattam-celebration", "acknowledge"],
    mutationFn: async () => {
      const response = await apiClient.patch("settings", {
        json: {
          markMokattamThemeCelebrationSeen: true,
        },
      });

      return response.json<UserSettingsResponse>();
    },
    onMutate: () => {
      const previousLocalSnapshot = readLocalUserSettings();

      updateLocalUserSettings({
        mokattamThemeCelebrationSeenAt:
          previousLocalSnapshot.settings.mokattamThemeCelebrationSeenAt ??
          new Date().toISOString(),
      });

      return { previousLocalSnapshot };
    },
    onError: (_error, _variables, context) => {
      if (!context) {
        return;
      }

      writeLocalUserSettings(
        context.previousLocalSnapshot.settings,
        context.previousLocalSnapshot.updatedAt
      );
    },
    onSuccess: async (data) => {
      syncCachedSettings(data.settings);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.userSettings.current,
        exact: true,
      });
    },
  });

  const activateThemeMutation = useMutation({
    mutationKey: ["settings", "mokattam-celebration", "activate"],
    mutationFn: async () => {
      const response = await apiClient.patch("settings", {
        json: {
          mokattamThemeEnabled: true,
          markMokattamThemeCelebrationSeen: true,
        },
      });

      return response.json<UserSettingsResponse>();
    },
    onMutate: () => {
      const previousLocalSnapshot = readLocalUserSettings();

      updateLocalUserSettings({
        mokattamThemeEnabled: true,
        mokattamThemeCelebrationSeenAt:
          previousLocalSnapshot.settings.mokattamThemeCelebrationSeenAt ??
          new Date().toISOString(),
      });

      return { previousLocalSnapshot };
    },
    onSuccess: async (data) => {
      syncCachedSettings(data.settings);
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.userSettings.current,
        exact: true,
      });
    },
    onError: (_error, _variables, context) => {
      if (context) {
        writeLocalUserSettings(
          context.previousLocalSnapshot.settings,
          context.previousLocalSnapshot.updatedAt
        );
      }

      toast.error(t("celebrationActivationError"));
    },
  });

  useEffect(() => {
    return () => {
      for (const timeoutId of confettiTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      lastCelebrationKeyRef.current = null;
      setOpen(false);
    }
  }, [userId]);

  useEffect(() => {
    if (
      !userId ||
      !remoteSettings?.mokattamThemeAvailable ||
      remoteSettings.mokattamThemeCelebrationSeenAt
    ) {
      return;
    }

    const celebrationKey = `${userId}:${remoteSettings.updatedAt ?? "pending"}`;

    if (lastCelebrationKeyRef.current === celebrationKey) {
      return;
    }

    lastCelebrationKeyRef.current = celebrationKey;
    setOpen(true);

    for (const timeoutId of confettiTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }

    confettiRef.current?.fire({
      particleCount: 140,
      spread: 100,
      startVelocity: 46,
      gravity: 0.85,
      ticks: 260,
      scalar: 1.15,
      origin: MOKATTAM_CONFETTI_ORIGIN,
      colors: MOKATTAM_CONFETTI_COLORS,
    });

    confettiTimeoutsRef.current = [
      window.setTimeout(() => {
        confettiRef.current?.fire({
          particleCount: 90,
          spread: 150,
          startVelocity: 38,
          gravity: 0.7,
          ticks: 220,
          scalar: 1,
          origin: MOKATTAM_CONFETTI_ORIGIN,
          colors: MOKATTAM_CONFETTI_COLORS,
        });
      }, 180),
      window.setTimeout(() => {
        confettiRef.current?.fire({
          particleCount: 90,
          spread: 180,
          startVelocity: 32,
          gravity: 0.68,
          ticks: 240,
          scalar: 0.95,
          origin: MOKATTAM_CONFETTI_ORIGIN,
          colors: MOKATTAM_CONFETTI_COLORS,
        });
      }, 260),
    ];

    if (!acknowledgeCelebrationMutation.isPending) {
      acknowledgeCelebrationMutation.mutate();
    }
  }, [acknowledgeCelebrationMutation, remoteSettings, userId]);

  return (
    <>
      <Confetti
        ref={confettiRef}
        className="pointer-events-none fixed inset-0 z-[60] size-full"
        manualstart
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden border-orange-200/80 bg-background p-0 dark:border-orange-500/25">
          <div className="bg-gradient-to-br from-orange-100 via-amber-50 to-background px-6 py-5 dark:from-orange-500/18 dark:via-orange-400/10 dark:to-background">
            <div className="flex items-center gap-2">
              <Badge className="border-orange-200 bg-white/85 text-orange-700 dark:border-orange-500/30 dark:bg-background/70 dark:text-orange-200">
                <Flame className="mr-1 size-3.5" />
                {t("badgeLabel")}
              </Badge>
              <Badge
                className="border-orange-200 bg-orange-500/10 text-orange-700 dark:border-orange-500/30 dark:text-orange-200"
                variant="outline"
              >
                <HeartHandshake className="mr-1 size-3.5" />
                {t("celebrationThankYou")}
              </Badge>
            </div>

            <DialogHeader className="mt-4 text-left">
              <DialogTitle className="text-2xl tracking-tight text-orange-950 dark:text-orange-50">
                {t("celebrationTitle")}
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-orange-950/80 dark:text-orange-100/85">
                {t("celebrationDescription")}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 px-6 pb-6">
            <div className="rounded-2xl border border-orange-200/70 bg-orange-50/70 p-4 dark:border-orange-500/20 dark:bg-orange-500/8">
              <p className="text-sm font-medium text-orange-900 dark:text-orange-100">
                {t("celebrationPreviewTitle")}
              </p>
              <p className="mt-2 text-sm leading-6 text-orange-900/75 dark:text-orange-100/80">
                {t("celebrationHint")}
              </p>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={activateThemeMutation.isPending}
              >
                {t("celebrationLater")}
              </Button>
              <Button
                type="button"
                className="bg-orange-600 text-white hover:bg-orange-700"
                onClick={() => activateThemeMutation.mutate()}
                disabled={activateThemeMutation.isPending}
              >
                {activateThemeMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {t("celebrationActivate")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
