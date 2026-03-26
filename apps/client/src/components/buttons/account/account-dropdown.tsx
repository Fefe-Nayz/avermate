"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { authClient } from "@/lib/auth";
import {
  Cog6ToothIcon,
  LifebuoyIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { LuGithub } from "react-icons/lu";
import SignOutButton from "../sign-out-button";
import ThemeSwitchButton from "../theme-switch-button";
import Avatar from "./avatar";
import { MessageSquareIcon, MessagesSquareIcon, Moon, Sun } from "lucide-react";
import FeedbackDialog from "@/components/dialogs/feedback-dialog";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useTranslations } from "next-intl";
import EarlyBirdBadge from "./early-bird-badge";
import MokattamBadge from "./mokattam-badge";
import { DropDrawer, DropDrawerTrigger, DropDrawerContent, DropDrawerLabel, DropDrawerSeparator, DropDrawerItem, DropDrawerGroup } from "@/components/ui/dropdrawer";

const isUnauthorizedSessionError = (error: unknown): error is { status: number } => {
  if (typeof error !== "object" || error === null) return false;
  if (!("status" in error)) return false;

  return (error as { status: number }).status === 401;
};

export default function AccountDropdown() {
  const t = useTranslations("Header.Dropdown");
  const router = useRouter();
  const pathname = usePathname();

  const { data, error, isPending, refetch } = authClient.useSession();
  const { data: userSettings } = useUserSettings(Boolean(data?.user?.id));

  const handleClick = () => {
    const currentPath = pathname + window.location.search || "/dashboard";
    localStorage.setItem("backFromSettings", currentPath);
  };

  const isOnboarding = pathname.startsWith("/onboarding");
  const triggerClassName = "group p-2 rounded-full outline-none";
  const hasResolvedAuthenticatedSession = useRef(false);
  const hasRetriedMissingSession = useRef(false);
  const hasRedirectedForMissingSession = useRef(false);

  useEffect(() => {
    if (data) {
      hasResolvedAuthenticatedSession.current = true;
      hasRetriedMissingSession.current = false;
      hasRedirectedForMissingSession.current = false;
    }
  }, [data]);

  useEffect(() => {
    if (!isPending || data) return;

    const timeout = window.setTimeout(() => {
      void refetch();
    }, 6000);

    return () => window.clearTimeout(timeout);
  }, [data, isPending, refetch]);

  useEffect(() => {
    if (isPending || hasRedirectedForMissingSession.current) return;

    if (!data) {
      if (localStorage.getItem("isSigningOut")) {
        hasRedirectedForMissingSession.current = true;
        router.replace("/auth/sign-in");
        return;
      }

      const isUnauthorized = isUnauthorizedSessionError(error);
      const hadSessionBefore = hasResolvedAuthenticatedSession.current;

      // Preserve mobile resume behavior: don't force-logout on transient non-401
      // failures when we already had an authenticated session.
      if (hadSessionBefore && !isUnauthorized) {
        return;
      }

      // Retry once before redirecting to avoid false negatives on first fetch.
      if (!hasRetriedMissingSession.current) {
        hasRetriedMissingSession.current = true;
        void refetch();
        return;
      }

      hasRedirectedForMissingSession.current = true;
      router.replace("/auth/sign-in");
      toast.error(t("notLoggedInTitle"), {
        description: t("notLoggedInDescription"),
      });
      return;
    }

    // Not verified
    if (!data.user.emailVerified) {
      // Send a verification OTP
      authClient.emailOtp.sendVerificationOtp({
        email: data.user.email,
        type: "email-verification",
      });

      toast.error(t("emailNotVerifiedTitle"), {
        description: t("emailNotVerifiedDescription", {
          email: data.user.email,
        }),
      });

      router.replace("/auth/verify-email");
      return;
    }
  }, [data, error, isPending, refetch, router, t]);

  if (!data && !isPending) {
    return (
      <DropDrawer>
        <DropDrawerTrigger className={triggerClassName}>
          <Skeleton className="size-8 rounded-full border border-transparent transition-all group-focus-visible:border-ring group-focus-visible:ring-ring/50 group-focus-visible:ring-[3px]" />
        </DropDrawerTrigger>
      </DropDrawer>
    );
  }

  return (
    <DropDrawer>
      <DropDrawerTrigger className={triggerClassName}>
        {isPending ? (
          <Skeleton className="size-8 rounded-full border border-transparent transition-all group-focus-visible:border-ring group-focus-visible:ring-ring/50 group-focus-visible:ring-[3px]" />
        ) : (
          <Avatar
            size={32}
            src={
              data?.user?.image
                ? data?.user?.image
                : `https://avatar.vercel.sh/${data?.user?.id}?size=32`
            }
            className="rounded-full size-8 border border-transparent transition-all group-focus-visible:border-ring group-focus-visible:ring-ring/50 group-focus-visible:ring-[3px]"
          />
        )}
      </DropDrawerTrigger>

      <DropDrawerContent>
        <DropDrawerLabel>
          <div className="flex flex-col items-center py-3 sm:items-start sm:py-0">
            <div className="flex gap-2 items-center">
              <Avatar
                size={32}
                src={
                  data?.user?.image
                    ? data?.user?.image
                    : `https://avatar.vercel.sh/${data?.user?.id}?size=32`
                }
                className="rounded-full size-8"
              />
              <div className="flex flex-col items-start">
                <h1 className="text-foreground font-semibold">
                  {data?.user?.name}{" "}
                  {data?.user &&
                    new Date(data?.user.createdAt).getTime() < 1756677600000 && (
                      <EarlyBirdBadge />
                    )}
                  {userSettings?.mokattamThemeAvailable ? <MokattamBadge /> : null}
                </h1>
                <p className="text-muted-foreground font-medium ">
                  {data?.user?.email}
                </p>
              </div>
            </div>
          </div>
        </DropDrawerLabel>

        <DropDrawerSeparator />

        <DropDrawerGroup>
          {isOnboarding ? (
            <DropDrawerItem disabled>
              <div className="flex items-center gap-2 opacity-50">
                <UserIcon className="size-4" />
                {t("profile")}
              </div>
            </DropDrawerItem>
          ) : (
            <Link href={`/profile`} onClick={handleClick}>
              <DropDrawerItem>
                <div className="flex items-center gap-2">
                  <UserIcon className="size-4" />
                  {t("profile")}
                </div>
              </DropDrawerItem>
            </Link>
          )}

          {isOnboarding ? (
            <DropDrawerItem disabled>
              <div className="flex items-center gap-2 opacity-50">
                <ShieldCheckIcon className="size-4" />
                {t("account")}
              </div>
            </DropDrawerItem>
          ) : (
            <Link href={`/profile/account`} onClick={handleClick}>
              <DropDrawerItem>
                <div className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-4" />
                  {t("account")}
                </div>
              </DropDrawerItem>
            </Link>
          )}

          {isOnboarding ? (
            <DropDrawerItem disabled>
              <div className="flex items-center gap-2 opacity-50">
                <Cog6ToothIcon className="size-4" />
                {t("settings")}
              </div>
            </DropDrawerItem>
          ) : (
            <Link href={`/profile/settings`} onClick={handleClick}>
              <DropDrawerItem>
                <div className="flex items-center gap-2">
                  <Cog6ToothIcon className="size-4" />
                  {t("settings")}
                </div>
              </DropDrawerItem>
            </Link>
          )}
        </DropDrawerGroup>

        {/* <DropDrawerLabel>{t("appearance")}</DropDrawerLabel> */}

        <DropDrawerSeparator />

        <DropDrawerGroup>
          <ThemeSwitchButton />
        </DropDrawerGroup>

        <DropDrawerSeparator />
        <DropDrawerGroup>

          <Link href="https://github.com/nayzflux/avermate">
            <DropDrawerItem>
              <div className="flex items-center gap-2">
                <LuGithub className="size-4" />
                {t("github")}
              </div>
            </DropDrawerItem>
          </Link>

          <Link href="https://discord.gg/DSCMg3MUzu#">
            <DropDrawerItem>
              <div className="flex items-center gap-2">
                <LifebuoyIcon className="size-4" />
                {t("support")}
              </div>
            </DropDrawerItem>
          </Link>


          <FeedbackDialog>
            <DropDrawerItem className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()}>
              <div className="flex items-center gap-2 w-full">
                <MessagesSquareIcon className="size-4" />
                {t("feedback")}
              </div>
            </DropDrawerItem>
          </FeedbackDialog>
        </DropDrawerGroup>

        <DropDrawerSeparator />

        <DropDrawerGroup>
          <SignOutButton />
        </DropDrawerGroup>
      </DropDrawerContent>
    </DropDrawer>
  );
}

