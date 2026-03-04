"use client";

import DashboardHeader from "@/components/dashboard/dashboard-header";
import DashboardNav from "@/components/nav/dashboard-nav";
import { usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { ReactNode, useEffect } from "react";

export default function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isMobile) return;
    window.scrollTo(0, 0);
  }, [isMobile, pathname]);

  return (
    <div className="flex flex-col shadow-[0px_4px_64px_0px_rgba(255,255,255,0.05)_inset] min-h-screen h-full">
      {/* Header */}
      <DashboardHeader />

      <DashboardNav />

      {/* Page */}
      <div className="px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 py-4 sm:py-16 pb-24 md:pb-16">
        {children}
      </div>
    </div>
  );
}
