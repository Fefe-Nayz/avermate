"use client";

import DashboardHeader from "@/components/dashboard/dashboard-header";
import TimelineModeBanner from "@/components/dashboard/timeline-mode-banner";
import {
  getMobileSettingsTitle,
  MobileSettingsDetailHeader,
} from "@/components/settings/mobile-settings-shell";
import { useMobileScrollReset } from "@/hooks/use-mobile-scroll-reset";
import DashboardNav from "@/components/nav/dashboard-nav";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import ProfileNav from "./profile-nav";

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useMobileScrollReset();

  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Settings.Nav");

  // Show navbar on all profile pages (settings, account, etc.)
  const showNav = pathname.startsWith("/profile");
  const mobileSettingsTitle = getMobileSettingsTitle(pathname, t);

  // Retrieve the `from` param if it exists, otherwise default to "/"
  const [returnUrl, setReturnUrl] = useState("/dashboard");

  useEffect(() => {
    const storedFrom = localStorage.getItem("backFromSettings");
    if (
      storedFrom &&
      storedFrom !== "/profile" &&
      storedFrom !== "/profile/account" &&
      storedFrom !== "/profile/settings" &&
      storedFrom !== "/profile/about"
    ) {
      setReturnUrl(storedFrom);
    } else {
      setReturnUrl("/dashboard");
    }
  }, []);

  const handleBack = () => {
    router.push(returnUrl);
    localStorage.removeItem("backFromSettings");
  };

  return (
    <div className="flex flex-col shadow-[0px_4px_64px_0px_rgba(255,255,255,0.05)_inset] min-h-screen h-full">
      <DashboardHeader />
      {showNav && <DashboardNav />}
      {showNav && <TimelineModeBanner />}
      <div className="px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 py-4 sm:py-16 pb-24 md:pb-16">
        {/* Pass the handleBack function to ProfileNav */}
        <div className="m-auto flex max-w-[2000px] flex-col gap-4 md:flex-row md:gap-8">
          <div className="hidden md:block">
            <ProfileNav onBack={handleBack} />
          </div>

          <div className="flex w-full flex-col gap-4 md:gap-8">
            {mobileSettingsTitle ? (
              <MobileSettingsDetailHeader title={mobileSettingsTitle} />
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
