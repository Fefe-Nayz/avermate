import { Button } from "@/components/ui/button";
import { CursorArrowRippleIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { RocketIcon } from "lucide-react";

export const OnboardingButton = ({ yearId }: { yearId: string }) => {
  const t = useTranslations("Dashboard.EmptyStates.Onboarding");

  return (
    <Button asChild size="sm">
      <Link href={`/onboarding/${yearId}`}>
        <RocketIcon className="size-4" />
        {t("configureSpace")}
      </Link>
    </Button>
  );
};
