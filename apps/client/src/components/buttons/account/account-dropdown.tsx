"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth";
import {
  Cog6ToothIcon,
  LifebuoyIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { Session, User } from "better-auth/types";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { LuGithub } from "react-icons/lu";
import SignOutButton from "../sign-out-button";
import ThemeSwitchButton from "../theme-switch-button";
import Avatar from "./avatar";
import { MessageSquareIcon, MessagesSquareIcon, Moon, Sun } from "lucide-react";
import FeedbackDialog from "@/components/dialogs/feedback-dialog";
import { useTranslations } from "next-intl";
import EarlyBirdBadge from "./early-bird-badge";
import { DropDrawer, DropDrawerTrigger, DropDrawerContent, DropDrawerLabel, DropDrawerSeparator, DropDrawerItem, DropDrawerGroup } from "@/components/ui/dropdrawer";
import { Button } from "@/components/ui/button";

export default function AccountDropdown() {
  const toaster = useToast();
  const t = useTranslations("Header.Dropdown");
  const router = useRouter();
  const pathname = usePathname();

  const { data, isPending } = authClient.useSession();

  const handleClick = () => {
    const currentPath = pathname + window.location.search || "/dashboard";
    localStorage.setItem("backFromSettings", currentPath);
  };

  useEffect(() => {
    if (isPending) return;

    // Skip check if there's no data but we're in the process of signing out
    if (!data && !localStorage.getItem("isSigningOut")) {
      router.push("/auth/sign-in");

      toaster.toast({
        title: t("notLoggedInTitle"),
        description: t("notLoggedInDescription"),
      });

      return;
    } else if (!data && localStorage.getItem("isSigningOut")) {
      router.push("/auth/sign-in");
      return;
    }

    if (!data) return;

    // Not verified
    if (!data.user.emailVerified) {
      // Send a verification link
      authClient.sendVerificationEmail({
        email: data.user.email,
      });

      toaster.toast({
        title: t("emailNotVerifiedTitle"),
        description: t("emailNotVerifiedDescription", {
          email: data.user.email,
        }),
      });

      router.push("/auth/verify-email");
      return;
    }
  }, [data, isPending]);

  if (!data && !isPending) {
    return (
      <DropDrawer>
        <DropDrawerTrigger>
          <div className="p-2">
            <Skeleton className="size-8 rounded-full" />
          </div>
        </DropDrawerTrigger>
      </DropDrawer>
    );
  }

  return (
    <DropDrawer>
      <DropDrawerTrigger>
        <div className="p-2">
          {isPending ? (
            <Skeleton className="size-8 rounded-full" />
          ) : (
            <Avatar
              size={32}
              src={
                data?.user?.image
                  ? data?.user?.image
                  : `https://avatar.vercel.sh/${data?.user?.id}?size=32`
              }
              className="rounded-full size-8"
            />
          )}
        </div>
      </DropDrawerTrigger>

      <DropDrawerContent className="mr-4">
        <DropDrawerLabel>
          <div className="flex flex-col items-center py-6 sm:items-start sm:py-0">
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
                <h1 className="text-white font-semibold">{data?.user?.name} {(data?.user && (new Date(data?.user.createdAt).getTime() < 1756677600000)) && <EarlyBirdBadge />}</h1>
                <p className="text-muted-foreground font-medium ">
                  {data?.user?.email}
                </p>
              </div>
            </div>
          </div>
        </DropDrawerLabel>

        <DropDrawerSeparator />

        <DropDrawerGroup>
          <Link href={`/profile`} onClick={handleClick}>
            <DropDrawerItem>
              <div className="flex items-center gap-2">
                <UserIcon className="size-4" />
                {t("profile")}
              </div>
            </DropDrawerItem>
          </Link>

          <Link href={`/profile/account`} onClick={handleClick}>
            <DropDrawerItem>
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="size-4" />
                {t("account")}
              </div>
            </DropDrawerItem>
          </Link>

          <Link href={`/profile/settings`} onClick={handleClick}>
            <DropDrawerItem>
              <div className="flex items-center gap-2">
                <Cog6ToothIcon className="size-4" />
                {t("settings")}
              </div>
            </DropDrawerItem>
          </Link>
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
            <DropDrawerItem onSelect={(e) => e.preventDefault()}>
              <div className="flex items-center gap-2">
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
