"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { MessageSquareIcon } from "lucide-react";
import FeedbackDialog from "@/components/dialogs/feedback-dialog";
import { useTranslations } from "next-intl";
import EarlyBirdBadge from "./early-bird-badge";

export default function AccountDropdown() {
  const toaster = useToast();
  const t = useTranslations("Header.Dropdown");
  const router = useRouter();
  const pathname = usePathname();

  const { data, isPending } = authClient.useSession() as unknown as {
    data: { user: User; session: Session };
    isPending: boolean;
  };

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
      <DropdownMenu>
        <DropdownMenuTrigger>
          <div className="p-2">
            <Skeleton className="size-8 rounded-full" />
          </div>
        </DropdownMenuTrigger>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
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
      </DropdownMenuTrigger>

      <DropdownMenuContent className="mr-4">
        <DropdownMenuLabel className="flex gap-2 items-center">
          <Avatar
            size={32}
            src={
              data?.user?.image
                ? data?.user?.image
                : `https://avatar.vercel.sh/${data?.user?.id}?size=32`
            }
            className="rounded-full size-8"
          />
          <div className="flex flex-col">
            <h1>{data?.user?.name} {(data?.user && (new Date(data?.user.createdAt).getTime() < 1756677600000)) && <EarlyBirdBadge />}</h1>
            <p className="text-muted-foreground font-medium ">
              {data?.user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/profile`} onClick={handleClick}>
            <UserIcon className="size-4 mr-2" />
            {t("profile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/profile/account`} onClick={handleClick}>
            <ShieldCheckIcon className="size-4 mr-2" />
            {t("account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          {/* Pass current page as 'from' parameter */}
          <Link href={`/profile/settings`} onClick={handleClick}>
            <Cog6ToothIcon className="size-4 mr-2" />
            {t("settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuLabel>{t("appearance")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeSwitchButton />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="https://github.com/nayzflux/avermate">
            <LuGithub className="size-4 mr-2" />
            {t("github")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="https://discord.gg/DSCMg3MUzu">
            <LifebuoyIcon className="size-4 mr-2" />
            {t("support")}
          </Link>
        </DropdownMenuItem>
        <FeedbackDialog>
          <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
            <span>
              <MessageSquareIcon className="size-4 mr-2" />
              {t("feedback")}
            </span>
          </DropdownMenuItem>
        </FeedbackDialog>

        <DropdownMenuSeparator />

        <SignOutButton />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
