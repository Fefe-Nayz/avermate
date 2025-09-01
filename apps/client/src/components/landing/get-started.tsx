"use client";

import { GetStartedButton } from "../buttons/get-started-button";
import { GoToDashboardButton } from "../buttons/go-to-dashboard-button";
import { useSession } from "@/hooks/use-session";

export const GetStarted = () => {
  const {
    data: session,
    isLoading,
    isError,
  } = useSession();

  if (isLoading || !session || isError) {
    return <GetStartedButton />;
  }

  return <GoToDashboardButton />;
};
