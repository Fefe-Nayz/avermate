"use client";

import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconMessageCircle,
  IconNotification,
  IconUserCircle,
  IconSparkles,
} from "@tabler/icons-react";
import {
  Cog6ToothIcon,
  LifebuoyIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { LuGithub } from "react-icons/lu";
import { MessagesSquareIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropDrawer,
  DropDrawerTrigger,
  DropDrawerContent,
  DropDrawerLabel,
  DropDrawerSeparator,
  DropDrawerItem,
  DropDrawerGroup,
} from "@/components/ui/dropdrawer";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth";
import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { toast } from "sonner";

// Import components from the previous version
import EarlyBirdBadge from "@/components/buttons/account/early-bird-badge";
import FeedbackDialog from "@/components/dialogs/feedback-dialog";
import ThemeSwitchButton from "@/components/buttons/theme-switch-button";
import SignOutButton from "@/components/buttons/sign-out-button";

export function NavUser({ iconOnly = false }: { iconOnly?: boolean }) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Header.Dropdown");

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

      toast.error(t("notLoggedInTitle"), {
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

      toast.error(t("emailNotVerifiedTitle"), {
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

  const TriggerButton = (
    <SidebarMenuButton
      size={iconOnly ? "default" : "lg"}
      className={cn(
        "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
        iconOnly && [
          // Ensure good hover/active/open states outside sidebar context
          "group size-8 p-1 justify-center shrink-0 rounded-md outline-none transition-all",
          "hover:bg-muted hover:text-foreground",
          "active:bg-muted/80 active:text-foreground",
          // Match button/breadcrumb focus ring
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          // Tab-like outline when open
          "data-[state=open]:bg-transparent data-[state=open]:text-foreground",
          "data-[state=open]:border-ring data-[state=open]:ring-ring/50 data-[state=open]:ring-[3px]",
        ]
      )}
    >
      {isPending ? (
        <Skeleton className="h-8 w-8 rounded-lg" />
      ) : (
        <Avatar className="h-8 w-8 rounded-lg grayscale transition-all group-hover:!rounded-md group-focus-visible:!rounded-md group-aria-expanded:!rounded-md group-data-[state=open]:!rounded-md">
          <AvatarImage
            src={
              data?.user?.image
                ? data?.user?.image
                : `https://avatar.vercel.sh/${data?.user?.id}?size=32`
            }
            alt={data?.user?.name || "User"}
          />
          <AvatarFallback className="rounded-lg group-hover:!rounded-md group-focus-visible:!rounded-md group-aria-expanded:!rounded-md group-data-[state=open]:!rounded-md">
            {data?.user?.name ? data.user.name.charAt(0).toUpperCase() : "U"}
            {data?.user?.name && data.user.name.length > 1
              ? data.user.name.charAt(1).toUpperCase()
              : ""}
          </AvatarFallback>
        </Avatar>
      )}
      {!iconOnly && !isPending && (
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{data?.user?.name}</span>
          <span className="text-muted-foreground truncate text-xs">
            {data?.user?.email}
          </span>
        </div>
      )}
      {!iconOnly && <IconDotsVertical className="ml-auto size-4" />}
    </SidebarMenuButton>
  );

  const MenuContent = (
    <DropDrawerContent>
      <DropDrawerLabel>
        <div className="flex flex-col items-center py-3 sm:items-start sm:py-0">
          <div className="flex gap-2 items-center">
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage
                src={
                  data?.user?.image
                    ? data?.user?.image
                    : `https://avatar.vercel.sh/${data?.user?.id}?size=32`
                }
                alt={data?.user?.name || "User"}
              />
              <AvatarFallback className="rounded-lg">
                {data?.user?.name
                  ? data.user.name.charAt(0).toUpperCase()
                  : "U"}
                {data?.user?.name && data.user.name.length > 1
                  ? data.user.name.charAt(1).toUpperCase()
                  : ""}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-start">
              <h1 className="text-foreground font-semibold">
                {data?.user?.name}{" "}
                {data?.user &&
                  new Date(data?.user.createdAt).getTime() < 1756677600000 && (
                    <EarlyBirdBadge />
                  )}
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
        <Link href={`/dashboard/profile`} onClick={handleClick}>
          <DropDrawerItem>
            <div className="flex items-center gap-2">
              <UserIcon className="size-4" />
              {t("profile")}
            </div>
          </DropDrawerItem>
        </Link>

        <Link href={`/dashboard/profile/account`} onClick={handleClick}>
          <DropDrawerItem>
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4" />
              {t("account")}
            </div>
          </DropDrawerItem>
        </Link>

        <Link href={`/dashboard/profile/settings`} onClick={handleClick}>
          <DropDrawerItem>
            <div className="flex items-center gap-2">
              <Cog6ToothIcon className="size-4" />
              {t("settings")}
            </div>
          </DropDrawerItem>
        </Link>
      </DropDrawerGroup>

      <DropDrawerSeparator />

      <DropDrawerGroup>
        <DropDrawerItem>
          <div className="flex items-center gap-2">
            <IconSparkles className="size-4" />
            Upgrade to Pro
          </div>
        </DropDrawerItem>
      </DropDrawerGroup>

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
          <DropDrawerItem
            className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4"
            onSelect={(e) => e.preventDefault()}
          >
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
  );

  if (iconOnly) {
    return (
      <DropDrawer>
        <DropDrawerTrigger asChild>{TriggerButton}</DropDrawerTrigger>
        {MenuContent}
      </DropDrawer>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropDrawer>
          <DropDrawerTrigger asChild>{TriggerButton}</DropDrawerTrigger>
          {MenuContent}
        </DropDrawer>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
