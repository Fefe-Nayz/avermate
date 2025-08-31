import AccountDropdown from "@/components/buttons/account/account-dropdown";
import Logo from "@/components/logo";
import YearWorkspaceSelect from "../selects/year-workspace-select";

export default function DashboardHeader({ hideWorkspaces }: { hideWorkspaces?: boolean }) {
  return (
    // <header className=" border-b border-solid px-4 py-1">
    //   <div className="max-w-[2000px] flex items-center justify-between gap-8 m-auto">
    //     <div className="flex items-center gap-[8px] xs:gap-[30px] flex-col xs:flex-row">
    //       <Logo />
    //       <DashboardNav />
    //     </div>
    //     <AccountDropdown />
    //   </div>
    // </header>

    <header className="flex justify-center sticky border-b px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 py-4 sm:py-8">
      <div className="flex w-full items-center justify-between gap-8 max-w-[2000px]">
        <Logo />

        <div className="flex items-center justify-between gap-4">
          {!hideWorkspaces && <YearWorkspaceSelect />}
          <AccountDropdown />
        </div>
      </div>
    </header>
  );
}
