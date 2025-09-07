"use client";

import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { DropDrawerItem } from "../ui/dropdrawer";

export default function ThemeSwitchButton() {
  const theme = useTheme();
  const t = useTranslations("Header.Dropdown");

  const handleSwitch = () => {
    if (theme.resolvedTheme === "dark") {
      theme.setTheme("light");
    } else {
      theme.setTheme("dark");
    }
  };

  return (


    <DropDrawerItem onClick={() => handleSwitch()}>
      <div className="flex items-center gap-2">
        {theme.resolvedTheme === "dark" ? (
          <>
            <SunIcon className="size-4" />
            {t("switchToLight")}
          </>
        ) : (
          <>
            <MoonIcon className="size-4" />
            {t("switchToDark")}
          </>
        )}
      </div>
    </DropDrawerItem>
  );
}
