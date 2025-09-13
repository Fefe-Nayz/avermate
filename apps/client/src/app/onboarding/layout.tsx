import DashboardHeader from "@/components/dashboard/dashboard-header";
import { ReactNode } from "react";

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen h-screen overflow-hidden">
      {/* Header */}
      <DashboardHeader hideWorkspaces={true} />

      {/* Page Content - full height minus header */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 py-4 sm:py-8 max-w-[2000px] mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
