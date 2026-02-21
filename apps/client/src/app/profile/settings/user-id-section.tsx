"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import ProfileSection from "../profile-section";

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);

  if (!copied) {
    throw new Error("COPY_FAILED");
  }
}

export const UserIdSection = () => {
  const tDeveloper = useTranslations("Settings.Settings.DeveloperOptions");
  const t = useTranslations("Settings.Settings.UserId");
  const { data: session, isPending } = authClient.useSession();
  const { data: isAdminFromServer } = useAdminAccess(Boolean(session));
  const [isOpen, setIsOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const userId = session?.user?.id ?? null;
  const currentRole = (session?.user as { role?: string | null } | undefined)?.role;
  const roleBasedIsAdmin = currentRole
    ? currentRole.split(",").some((value) => value.trim() === "admin")
    : false;
  const isAdmin = roleBasedIsAdmin || Boolean(isAdminFromServer);

  const handleCopy = async () => {
    if (!userId) {
      toast.error(t("copyError"));
      return;
    }

    try {
      setIsCopying(true);
      await copyToClipboard(userId);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyError"));
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between">
          {tDeveloper("toggle")}
          <ChevronDown
            className={cn("size-4 transition-transform", isOpen && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="pt-3">
        <ProfileSection
          title={tDeveloper("title")}
          description={tDeveloper("description")}
        >
          <div className="flex flex-col gap-4">
            <div className="px-6 grid gap-4 pb-4">
              <div className="rounded-md border p-3">
                <p className="text-sm text-muted-foreground">{t("label")}</p>
                <p className="mt-1 break-all font-mono text-xs sm:text-sm">
                  {userId ?? t("unavailable")}
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                disabled={isPending || !userId || isCopying}
                onClick={handleCopy}
                className="w-full sm:w-fit"
              >
                {isCopied ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <Copy className="size-4" />
                )}
                {t("copyButton")}
              </Button>

              {isAdmin ? (
                <Button asChild type="button" variant="outline" className="w-full sm:w-fit">
                  <Link href="/dashboard/admin">
                    <Shield className="size-4" />
                    {tDeveloper("adminDashboardLink")}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </ProfileSection>
      </CollapsibleContent>
    </Collapsible>
  );
};
