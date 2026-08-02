import type { Metadata } from "next";
import { useExtracted } from "next-intl";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  const t = useExtracted();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t("Terms of service")}
      </h1>

      <p>
        {t(
          "Using Avermate means accepting these terms. They are short on purpose.",
        )}
      </p>

      <h2>{t("The service")}</h2>
      <p>
        {t(
          "Avermate is a free tool for tracking school results and computing averages. It is provided as it is, with no guarantee that it will be available at all times.",
        )}
      </p>

      <h2>{t("Your account")}</h2>
      <p>
        {t(
          "You are responsible for what happens under your account and for keeping your password to yourself. One account per person.",
        )}
      </p>

      <h2>{t("Your data is yours")}</h2>
      <p>
        {t(
          "Everything you enter belongs to you. You can export it or delete it whenever you want. We claim no ownership over it.",
        )}
      </p>

      <h2>{t("What the numbers are worth")}</h2>
      <p>
        {t(
          "Averages, projections and goal plans are computed from what you enter, with the weighting you configure. They are an aid, not an official record: your school's own calculation is the one that counts.",
        )}
      </p>

      <h2>{t("Acceptable use")}</h2>
      <p>
        {t(
          "Do not attempt to break, overload or abuse the service, and do not use it to store anything unlawful.",
        )}
      </p>

      <h2>{t("Ending it")}</h2>
      <p>
        {t(
          "You can delete your account at any time. We may suspend an account that abuses the service, and we will say why.",
        )}
      </p>

      <h2>{t("Changes")}</h2>
      <p>
        {t(
          "If these terms change in a way that matters, we will announce it inside the app before it takes effect.",
        )}
      </p>
    </>
  );
}
