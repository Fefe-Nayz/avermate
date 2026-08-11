import type { Metadata } from "next"
import { useExtracted } from "next-intl"

export const metadata: Metadata = { title: "Privacy policy" }

export default function PrivacyPage() {
  const t = useExtracted()

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t("Privacy policy")}
      </h1>

      <p>
        {t(
          "Avermate stores the information you provide to calculate your results, personalize the service and, only when you choose it, power its social features."
        )}
      </p>

      <h2>{t("What we store")}</h2>
      <ul>
        <li>
          {t(
            "Your account: name, email address, and — if you signed in with Google or Microsoft — the identifier that provider gives us."
          )}
        </li>
        <li>
          {t(
            "Your school data: years, periods, subjects, coefficients, grades, goals and the layout of your dashboard."
          )}
        </li>
        <li>
          {t(
            "Your preferences: theme, language, and the small settings that make the app behave the way you like."
          )}
        </li>
        <li>
          {t(
            "Sessions: the device and approximate origin of each sign-in, so you can review and revoke them."
          )}
        </li>
        <li>
          {t(
            "Social activity, if you enable it: your social profile, friendship and group relationships, sharing choices, consent history, blocks, reports and notifications."
          )}
        </li>
      </ul>

      <h2>{t("Sharing with friends and groups")}</h2>
      <p>
        {t(
          "Social sharing is optional and off until your account is eligible and you turn it on. You choose individual profile fields that friends may see. A group can request a defined set of information, but joining requires a clear summary and explicit acceptance of the current sharing policy."
        )}
      </p>
      <p>
        {t(
          "A group only receives the fields covered by your active consent. If its policy changes, access to newly requested information stays paused until you review it. You can leave, withdraw consent, opt out of rankings, remove a friend or block an account from the social settings."
        )}
      </p>

      <h2>{t("Comparisons and rankings")}</h2>
      <p>
        {t(
          "Group statistics are intended to compare members who deliberately participate. Rankings are opt-in, use the group policy in force, and should not expose a member's underlying grades or subjects when those fields were not shared. Small cohorts may be withheld to reduce the risk of identifying someone from an aggregate."
        )}
      </p>

      <h2>{t("Younger users")}</h2>
      <p>
        {t(
          "Social access can depend on age, region and the account's verification state. Where a guardian step is required, social features remain unavailable until that step is recorded. Avermate may restrict social features for younger users even when the rest of the grade tracker remains available."
        )}
      </p>

      <h2>{t("What we do not do")}</h2>
      <p>
        {t(
          "We do not sell school data or provide it to advertisers. Authorized operations may process limited account information for support, safety, abuse investigation and service operation; access is expected to be restricted and auditable."
        )}
      </p>

      <h2>{t("Where it lives")}</h2>
      <p>
        {t(
          "Data is stored on servers in the European Union. Emails are sent through Resend, and uploaded avatars are hosted by UploadThing."
        )}
      </p>

      <h2>{t("Aggregates")}</h2>
      <p>
        {t(
          "Product metrics and broad comparisons can be calculated from aggregated data. Social group statistics follow a separate, versioned sharing policy and only include eligible, consenting members. Aggregates are suppressed where a cohort is too small for a meaningful privacy boundary."
        )}
      </p>

      <h2>{t("Retention and safety records")}</h2>
      <p>
        {t(
          "Most social content follows the lifecycle of your account or the relationship that created it. Some consent, moderation and security records may be retained for a limited period after withdrawal when needed to document choices, investigate abuse or meet operational obligations. Exact periods can depend on the type of record and applicable requirements."
        )}
      </p>

      <h2>{t("Your rights")}</h2>
      <p>
        {t(
          "Account settings let you request an export, clear school data, reset social data or delete the account. Some operations cannot be undone once processed. Backups and narrowly retained safety records may expire on a separate operational schedule."
        )}
      </p>

      <h2>{t("Contact")}</h2>
      <p>
        {t(
          "Questions about any of this can be sent through the feedback form in the app."
        )}
      </p>
    </>
  )
}
