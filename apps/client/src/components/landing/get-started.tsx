"use client";

import { GetStartedButton } from "../buttons/get-started-button";
import { GoToDashboardButton } from "../buttons/go-to-dashboard-button";
import { useSession } from "@/hooks/use-session";
import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { Button } from "../ui/button";
import { Loader2Icon } from "lucide-react";

export const GetStarted = ({ headerStyle = false }: { headerStyle?: boolean }) => {
  const {
    data: session,
    isLoading,
    isError,
  } = useSession();


  if (isLoading) {
      if (headerStyle) {
        return (
          <Link
            href="/auth/sign-up"
            className="bg-secondary flex h-8 items-center justify-center text-sm font-normal tracking-wide rounded-full text-secondary-foreground w-fit px-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] border border-white/[0.12]"
          >
            <Loader2Icon className="animate-spin h-4 w-4" />
          </Link>
        );
      }

      return (
        <div className="h-12 flex items-center justify-center">
          <Button size="default" asChild className="hidden sm:inline-flex group">
            <Link href="/auth/sign-up">
              <Loader2Icon className="animate-spin mr-2 h-4 w-4" />
              <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
          <Button size="sm" asChild className="inline-flex sm:hidden group">
            <Link href="/auth/sign-up">
              <Loader2Icon className="animate-spin mr-2 h-4 w-4" />
              <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>
      );
    };


  if (!session || isError) {
    return <GetStartedButton headerStyle={headerStyle} />;
  }

  return <GoToDashboardButton headerStyle={headerStyle} />;
};
