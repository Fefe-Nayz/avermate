import { Button } from "@/components/ui/button";
import { CursorArrowRippleIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useTranslations } from "next-intl";

export const OnboardingButton = ({ yearId }: { yearId: string }) => {
  const t = useTranslations("Dashboard.EmptyStates.Onboarding");

  return (
    <Button asChild>
      <Link href={`/onboarding/${yearId}`}>
        <CursorArrowRippleIcon className="size-4 mr-2" />
        {t("configureSpace")}
      </Link>
    </Button>
  );
};
