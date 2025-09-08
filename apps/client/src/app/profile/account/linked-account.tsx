"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FaGoogle, FaMicrosoft } from "react-icons/fa";
import { KeyRoundIcon, Link as LinkIcon, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

import ProfileSection from "../profile-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";

import { env } from "@/lib/env";
import { authClient } from "@/lib/auth";
import { useAccounts } from "@/hooks/use-accounts";
import { getPasswordStrength } from "@/utils/password";

type ProviderId = "google" | "microsoft";

interface SocialProvider {
  id: ProviderId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SOCIAL_PROVIDERS: SocialProvider[] = [
  { id: "google", label: "Google", icon: FaGoogle },
  { id: "microsoft", label: "Microsoft", icon: FaMicrosoft },
];

export default function LinkedAccount() {
  const t = useTranslations("Settings.Account.LinkedAccounts");
  const authT = useTranslations("Auth");

  const { data: accounts, isPending, isError } = useAccounts();
  const { data: session, isPending: isPendingSession } = authClient.useSession();

  const [linkingProvider, setLinkingProvider] = useState<ProviderId | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<ProviderId | null>(null);
  const [isPasswordResetOpen, setIsPasswordResetOpen] = useState(false);
  const [sendingPasswordReset, setSendingPasswordReset] = useState(false);

  const linkedProviders = new Set(accounts?.map((a) => a.providerId));
  const hasPassword = accounts?.some((a) => a.providerId === "credential");

  async function handleLinkAccount(provider: ProviderId) {
    try {
      setLinkingProvider(provider);
      await authClient.linkSocial({
        provider,
        callbackURL: `${env.NEXT_PUBLIC_CLIENT_URL}/profile/account`,
      });
    } catch (error: any) {
      toast.error(t("linkFailed"), {
        description: error?.message ?? t("linkFailedDescription"),
      });
      console.error(error);
    } finally {
      setLinkingProvider(null);
    }
  }

  async function handleUnlinkAccount(provider: ProviderId) {
    try {
      setUnlinkingProvider(provider);
      await authClient.unlinkAccount({ providerId: provider });
      toast.success(t("unlinked"), { description: t("unlinkSuccess", { provider }) });
    } catch (error: any) {
      toast.error(t("unlinkFailed"), {
        description:
          error?.message ?? t("unlinkFailedDescription"),
      });
      console.error(error);
    } finally {
      setUnlinkingProvider(null);
    }
  }

  async function handleSendPasswordReset() {
    if (!session?.user?.email) return;

    try {
      setSendingPasswordReset(true);
      await authClient.forgetPassword({
        email: session.user.email,
        redirectTo: `${env.NEXT_PUBLIC_CLIENT_URL}/auth/reset-password`,
      });
      toast.success(t("resetEmailSent"), {
        description: t("resetEmailSentDescription"),
      });
      // Redirect to reset password page
      window.location.href = "/auth/reset-password";
    } catch (error: any) {
      toast.error(t("resetEmailFailed"), {
        description: error?.message ?? t("resetEmailFailedDescription"),
      });
      console.error(error);
    } finally {
      setSendingPasswordReset(false);
    }
  } if (isError) {
    return <div>{<ErrorStateCard />}</div>;
  }

  if (isPending || isPendingSession) {
    return (
      <Card className="w-full">
        <div className="flex flex-col gap-6">
          <CardHeader className="pb-0">
            <CardTitle>
              <Skeleton className="w-36 h-6" />
            </CardTitle>
            <div>
              <Skeleton className="w-40 h-4" />
            </div>
          </CardHeader>

          <CardContent className="px-6 grid gap-4 pb-6">
            <div className="bg-card text-card-foreground flex rounded-xl border shadow-sm flex-row items-center gap-3 px-4 py-3 w-full">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ms-auto h-8 w-20 rounded-md" />
            </div>
            <div className="bg-card text-card-foreground flex rounded-xl border shadow-sm flex-row items-center gap-3 px-4 py-3 w-full">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ms-auto h-8 w-24 rounded-md" />
            </div>
          </CardContent>
        </div>
      </Card>
    );
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      {/* Card body (mirrors CustomAveragesSection padding/structure) */}
      <div className="px-6 grid gap-4 pb-6">
        {/* Password row */}
        <Collapsible open={isPasswordResetOpen} onOpenChange={setIsPasswordResetOpen}>
          <div className="bg-card text-card-foreground flex rounded-xl border shadow-sm flex-col">
            <div className="flex flex-row items-center gap-3 px-4 py-3">
              <KeyRoundIcon className="size-4" />
              <span className="text-sm">{t("password")}</span>

              {hasPassword ? (
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="ms-auto" type="button">
                    {t("resetPassword")}
                  </Button>
                </CollapsibleTrigger>
              ) : (
                <Button
                  className="ms-auto"
                  type="button"
                  disabled={sendingPasswordReset}
                  onClick={handleSendPasswordReset}
                >
                  {sendingPasswordReset ? (
                    t("sending")
                  ) : (
                    <>
                      <LinkIcon className="size-4 mr-2" />
                      {t("setPassword")}
                    </>
                  )}
                </Button>
              )}
            </div>

            {hasPassword && (
              <CollapsibleContent>
                <div className="px-4 pb-4 border-t bg-muted/30">
                  <PasswordResetForm onClose={() => setIsPasswordResetOpen(false)} />
                </div>
              </CollapsibleContent>
            )}
          </div>
        </Collapsible>

        {/* Providers rows */}
        {SOCIAL_PROVIDERS.map(({ id, label, icon: Icon }) => {
          const isLinked = linkedProviders.has(id);
          return (
            <div
              key={id}
              className="bg-card text-card-foreground flex rounded-xl border shadow-sm flex-row items-center gap-3 px-4 py-3"
            >
              <Icon className="size-4" />
              <span className="text-sm">{label}</span>

              {isLinked ? (
                <Button
                  variant="outline"
                  className="ms-auto"
                  type="button"
                  disabled={unlinkingProvider === id}
                  onClick={() => handleUnlinkAccount(id)}
                >
                  {unlinkingProvider === id ? t("unlinking") : t("unlink")}
                </Button>
              ) : (
                <Button
                  className="ms-auto"
                  type="button"
                  disabled={linkingProvider === id}
                  onClick={() => handleLinkAccount(id)}
                >
                  {linkingProvider === id ? t("linkingWith", { label }) : t("link", { label })}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </ProfileSection>
  );
}

/* ----------------------------- Password Reset Form ----------------------------- */

function PasswordResetForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Settings.Account.LinkedAccounts");
  const authT = useTranslations("Auth.Reset");

  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleVisibility = () => setIsVisible((prevState) => !prevState);

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case "weak":
        return "bg-red-500";
      case "medium":
        return "bg-amber-500";
      case "strong":
        return "bg-emerald-500";
      default:
        return "bg-border";
    }
  };

  const getStrengthGlow = (strength: string) => {
    switch (strength) {
      case "weak":
        return "rgba(239, 68, 68, 0.6)";
      case "medium":
        return "rgba(245, 158, 11, 0.6)";
      case "strong":
        return "rgba(16, 185, 129, 0.6)";
      default:
        return "transparent";
    }
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword || !currentPassword) {
      toast.error(t("missingFields"), { description: t("missingFieldsDescription") });
      return;
    }
    if (newPassword !== confirm) {
      toast.error(t("passwordsDoNotMatch"), { description: t("passwordsDoNotMatchDescription") });
      return;
    }

    const strength = getPasswordStrength(newPassword);
    if (strength.strength === "weak") {
      toast.error(authT("passwordTooWeak"), { description: t("passwordTooWeakDescription") });
      return;
    }

    try {
      setLoading(true);
      await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      toast.success(t("passwordUpdated"), { description: t("passwordUpdatedDescription") });
      onClose();
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err: any) {
      toast.error(t("updateFailed"), {
        description: err?.message ?? t("updateFailedDescription"),
      });
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 mt-4">
      <div className="grid gap-2">
        <Label htmlFor="current" className="text-sm font-medium">{t("currentPassword")}</Label>
        <Input
          id="current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className="bg-background"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="new" className="text-sm font-medium">{t("newPassword")}</Label>
        <div className="relative">
          <Input
            id="new"
            className="pe-9 bg-background"
            type={isVisible ? "text" : "password"}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <button
            className="absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-lg text-muted-foreground/80 outline-offset-2 transition-colors hover:text-foreground focus:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={toggleVisibility}
            aria-label={isVisible ? authT("hidePassword") : authT("showPassword")}
            aria-pressed={isVisible}
            aria-controls="new"
          >
            {isVisible ? (
              <EyeOff size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Eye size={16} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Password strength indicator */}
        <div
          role="progressbar"
          aria-label={authT("passwordStrength")}
          className="bg-border h-1 w-full rounded-full relative"
          aria-valuenow={getPasswordStrength(newPassword).entropy}
          aria-valuemin={0}
          aria-valuemax={4}
        >
          <motion.div
            initial={{ width: "0%" }}
            animate={{
              width: `${getPasswordStrength(newPassword).entropy * 100}%`,
            }}
            transition={{
              damping: 25,
              stiffness: 400,
              type: "spring",
            }}
            className={`${getStrengthColor(
              getPasswordStrength(newPassword).strength
            )} h-full rounded-full`}
            style={{
              boxShadow:
                getPasswordStrength(newPassword).entropy > 0
                  ? `0 0 8px 2px ${getStrengthGlow(
                    getPasswordStrength(newPassword).strength
                  )}`
                  : "none",
            }}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="confirm" className="text-sm font-medium">{t("confirmPassword")}</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="bg-background"
        />
      </div>

      <div className="flex gap-2 mt-2">
        <Button variant="outline" type="button" onClick={onClose} disabled={loading}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={loading} className="flex-1">
          {loading ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
