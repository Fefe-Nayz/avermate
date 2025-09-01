import Logo from "@/components/logo";
import { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className=" grid grid-cols-1 lg:grid-cols-2 h-screen">
      {/* Left */}
      <div className="flex items-center justify-around content-between w-screen">
        <main className="flex w-full lg:w-[50%] justify-center py-6 max-h-screen overflow-y-scroll">
          <div className="w-full px-4 sm:px-16 sm:[400px] md:w-[600px] gap-8 flex flex-col">
            {children}
          </div>
        </main>
        <main className="lg:flex gap-8 lg:w-[50%] hidden justify-center">
          <div className="border-l border-gray-900 bg-[rgba(250,250,250,0.02)] shadow-[inset_0px_0px_64px_0px_rgba(255,255,255,0.05)] flex flex-col justify-between items-end p-10 flex-1 self-stretch h-screen">
            <div className="flex items-center gap-2">
              <Logo />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
