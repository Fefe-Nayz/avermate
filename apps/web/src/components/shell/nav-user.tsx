"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronsUpDownIcon,
  BellIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  UserIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useExtracted } from "next-intl"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { signOut as signOutAndReset } from "@/lib/auth-client"
import type { AuthenticatedUser } from "@/lib/authenticated-user"
import { haptic } from "@/lib/haptics"
import { useFeedback } from "@/components/feedback/feedback-provider"
import { AccountBadges } from "@/components/settings/account-badges"
import { useSocialAccess } from "@/hooks/use-social-access"

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function NavUser({ user }: { user: AuthenticatedUser }) {
  const t = useExtracted()
  const router = useRouter()
  const { state } = useSidebar()
  const { setTheme, resolvedTheme } = useTheme()
  const feedback = useFeedback()
  const { canAccess: canAccessSocial } = useSocialAccess()

  const signOut = async () => {
    haptic("light")
    await signOutAndReset()
    router.replace("/auth/sign-in")
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[popup-open]:bg-sidebar-accent"
              />
            }
          >
            <Avatar className="size-8 rounded-lg">
              <AvatarImage src={user.image ?? undefined} alt={user.name} />
              <AvatarFallback className="rounded-lg">
                {initialsOf(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <AccountBadges createdAt={user.createdAt} />
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4 opacity-60" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            side={state === "collapsed" ? "right" : "top"}
            className="w-(--anchor-width) min-w-56"
          >
            {/* The address labels this group: everything in it acts on that
                account. Base UI requires the label to sit inside the group it
                names, which happens to be the honest structure anyway. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground">
                {user.email}
              </DropdownMenuLabel>
              <DropdownMenuItem render={<Link href="/settings" />}>
                <UserIcon className="size-4" />
                {t("Profile")}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/settings/appearance" />}>
                <SettingsIcon className="size-4" />
                {t("Preferences")}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/review" />}>
                <SparklesIcon className="size-4" />
                {t("Year in review")}
              </DropdownMenuItem>
              {canAccessSocial ? (
                <DropdownMenuItem render={<Link href="/social" />}>
                  <UsersRoundIcon className="size-4" />
                  {t("Social")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem render={<Link href="/announcements" />}>
                <BellIcon className="size-4" />
                {t("Announcements")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => feedback.open()}>
                <MessageSquarePlusIcon className="size-4" />
                {t("Send feedback")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                haptic("selection")
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }}
            >
              {resolvedTheme === "dark" ? (
                <SunIcon className="size-4" />
              ) : (
                <MoonIcon className="size-4" />
              )}
              {resolvedTheme === "dark" ? t("Light mode") : t("Dark mode")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={signOut}>
              <LogOutIcon className="size-4" />
              {t("Sign out")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
