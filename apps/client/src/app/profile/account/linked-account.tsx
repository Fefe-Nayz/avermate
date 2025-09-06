// THIS IS A PROOF OF CONCEPT ONLY, DO NOT PUSH TO PRODUCTION NOT FUNCTIONAL

"use client";

import { useState } from "react";
import NextLink from "next/link";
import { useTranslations } from "next-intl";
import { FaGoogle, FaMicrosoft } from "react-icons/fa";
import { KeyRoundIcon, Link as LinkIcon } from "lucide-react";

import ProfileSection from "../profile-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

import { env } from "@/lib/env";
import { authClient } from "@/lib/auth";
import { useAccounts } from "@/hooks/use-accounts";

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
  const { toast } = useToast();

  const { data: accounts, isPending, isError } = useAccounts();
  const { data: session, isPending: isPendingSession } = authClient.useSession();

  const [linkingProvider, setLinkingProvider] = useState<ProviderId | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<ProviderId | null>(null);

  const linkedProviders = new Set(accounts?.map((a) => a.provider));
  const hasPassword = accounts?.some((a) => a.provider === "credential");

  async function handleLinkAccount(provider: ProviderId) {
    try {
      setLinkingProvider(provider);
      await authClient.linkSocial({
        provider,
        callbackURL: `${env.NEXT_PUBLIC_CLIENT_URL}/profile/account`,
      });
    } catch (error: any) {
      toast({
        title: "Link failed",
        description: error?.message ?? "Could not link the account.",
        variant: "destructive",
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
      toast({ title: "Unlinked", description: `${provider} disconnected.` });
    } catch (error: any) {
      toast({
        title: "Unlink failed",
        description:
          error?.message ??
          "Unable to unlink. You may need at least one sign-in method or enable allowUnlinkingAll.",
        variant: "destructive",
      });
      console.error(error);
    } finally {
      setUnlinkingProvider(null);
    }
  }

  if (isError) {
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
        <div className="bg-card text-card-foreground flex rounded-xl border shadow-sm flex-row items-center gap-3 px-4 py-3">
          <KeyRoundIcon className="size-4" />
          <span className="text-sm">Password</span>

          {hasPassword ? (
            <ResetPasswordDialog>
              <Button variant="outline" className="ms-auto" type="button">
                Reset
              </Button>
            </ResetPasswordDialog>
          ) : (
            <Button asChild className="ms-auto" type="button">
              <NextLink href="/auth/forgot-password" className="inline-flex items-center gap-2">
                <LinkIcon className="size-4" />
                Set password
              </NextLink>
            </Button>
          )}
        </div>

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
                  {unlinkingProvider === id ? "Unlinking…" : "Unlink"}
                </Button>
              ) : (
                <Button
                  className="ms-auto"
                  type="button"
                  disabled={linkingProvider === id}
                  onClick={() => handleLinkAccount(id)}
                >
                  {linkingProvider === id ? `Linking ${label}…` : "Link"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </ProfileSection>
  );
}

/* ----------------------------- Reset Password ----------------------------- */

function ResetPasswordDialog({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword || !currentPassword) {
      toast({ title: "Missing fields", description: "Please fill all fields.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirm) {
      toast({ title: "Passwords do not match", description: "Make sure both passwords are identical.", variant: "destructive" });
      return;
    }

    try {
      setLoading(true);
      await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });

      toast({ title: "Password updated", description: "You’ll need to sign in again on other devices." });
      setOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err?.message ?? "Could not change the password.",
        variant: "destructive",
      });
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Change your password. Other active sessions will be revoked.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-3 mt-2">
          <div className="grid gap-1.5">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new">New password</Label>
            <Input
              id="new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
