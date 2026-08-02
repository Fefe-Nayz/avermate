import type { Metadata } from "next";
import { useExtracted } from "next-intl";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  const t = useExtracted();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t("Privacy policy")}
      </h1>

      <p>
        {t(
          "Avermate stores the grades you enter so it can compute your averages. That is the whole purpose of the service, and it is the only reason we hold that data.",
        )}
      </p>

      <h2>{t("What we store")}</h2>
      <ul>
        <li>
          {t(
            "Your account: name, email address, and — if you signed in with Google or Microsoft — the identifier that provider gives us.",
          )}
        </li>
        <li>
          {t(
            "Your school data: years, periods, subjects, coefficients, grades, goals and the layout of your dashboard.",
          )}
        </li>
        <li>
          {t(
            "Your preferences: theme, language, and the small settings that make the app behave the way you like.",
          )}
        </li>
        <li>
          {t(
            "Sessions: the device and approximate origin of each sign-in, so you can review and revoke them.",
          )}
        </li>
      </ul>

      <h2>{t("What we do not do")}</h2>
      <p>
        {t(
          "We do not sell your data, we do not share it with advertisers, and we do not use it to train anything. Nobody at Avermate reads your grades.",
        )}
      </p>

      <h2>{t("Where it lives")}</h2>
      <p>
        {t(
          "Data is stored on servers in the European Union. Emails are sent through Resend, and uploaded avatars are hosted by UploadThing.",
        )}
      </p>

      <h2>{t("Aggregates")}</h2>
      <p>
        {t(
          "The landing page shows counts, and the year-in-review shows where your average sits among all users. Both are computed from anonymous aggregates — no individual result is ever exposed to anyone else.",
        )}
      </p>

      <h2>{t("Your rights")}</h2>
      <p>
        {t(
          "You can export everything you have entered as a JSON file, clear all of your school data, or delete your account outright, all from the account settings. Deletion is immediate and permanent.",
        )}
      </p>

      <h2>{t("Contact")}</h2>
      <p>
        {t(
          "Questions about any of this can be sent through the feedback form in the app.",
        )}
      </p>
    </>
  );
}
