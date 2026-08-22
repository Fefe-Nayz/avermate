"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronsUpDownIcon,
  CircleUserRoundIcon,
  LogOutIcon,
  MessageSquarePlusIcon,
  UserIcon,
} from "lucide-react"
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
import { initialsOf } from "@/lib/name"
import { cn } from "@/lib/utils"
import { useFeedback } from "@/components/feedback/feedback-provider"
import { AccountBadges } from "@/components/settings/account-badges"

/**
 * Who you are, and the few actions that belong to the account itself.
 *
 * It mounts twice — full in the sidebar footer, `iconOnly` in the header —
 * and both share this one menu, which is what keeps them from drifting. The
 * menu deliberately carries no destinations: those live in the sidebar, and
 * the cross-app utilities live in the header. A menu that repeated them was
 * a third place to look for the same thing.
 */
export function NavUser({
  user,
  iconOnly = false,
}: {
  user: AuthenticatedUser
  iconOnly?: boolean
}) {
  const t = useExtracted()
  const router = useRouter()
  const { state, isMobile } = useSidebar()
  const feedback = useFeedback()

  const signOut = async () => {
    haptic("light")
    await signOutAndReset()
    router.replace("/auth/sign-in")
  }

  const trigger = (
    <SidebarMenuButton
      size={iconOnly ? "default" : "lg"}
      className={cn(
        "data-[popup-open]:bg-sidebar-accent",
        iconOnly && [
          // Outside the sidebar the button has no sidebar surface to sit on,
          // so it borrows the header's own hover and focus treatment. The
          // button is exactly the avatar — same size, same corner radius —
          // so the focus and open rings trace the picture, not a box
          // shifted around it.
          "group size-8 shrink-0 justify-center rounded-lg p-0 transition-all outline-none",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "data-[popup-open]:bg-transparent data-[popup-open]:ring-[3px] data-[popup-open]:ring-ring/50",
        ]
      )}
    >
      {/* The radius must land on all three layers: the root, its border
          overlay, and the image itself — AvatarImage bakes in its own
          rounded-full, so overriding the root alone left the picture a
          circle inside a squarer ring. */}
      <Avatar className="size-8 rounded-lg after:rounded-lg">
        <AvatarImage
          className="rounded-lg"
          src={user.image ?? undefined}
          alt={user.name}
        />
        <AvatarFallback className="rounded-lg">
          {initialsOf(user.name)}
        </AvatarFallback>
      </Avatar>
      {iconOnly ? null : (
        <>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user.name}</span>
            <AccountBadges createdAt={user.createdAt} />
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
          <ChevronsUpDownIcon className="ml-auto size-4 opacity-60" />
        </>
      )}
    </SidebarMenuButton>
  )

  const content = (
    <DropdownMenuContent
      align="end"
      side={
        iconOnly || isMobile
          ? "bottom"
          : state === "collapsed"
            ? "right"
            : "top"
      }
      sideOffset={6}
      className="w-(--anchor-width) min-w-56"
    >
      <DropdownMenuGroup>
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar className="size-8 rounded-lg after:rounded-lg">
              <AvatarImage
                className="rounded-lg"
                src={user.image ?? undefined}
                alt={user.name}
              />
              <AvatarFallback className="rounded-lg">
                {initialsOf(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem render={<Link href="/settings" />}>
          <UserIcon className="size-4" />
          {t("Profile")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings/account" />}>
          <CircleUserRoundIcon className="size-4" />
          {t("Account")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => feedback.open()}>
          <MessageSquarePlusIcon className="size-4" />
          {t("Send feedback")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={signOut}>
        <LogOutIcon className="size-4" />
        {t("Sign out")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )

  if (iconOnly) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        {content}
      </DropdownMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={trigger} />
          {content}
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
