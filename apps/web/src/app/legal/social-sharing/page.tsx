import type { Metadata } from "next"
import Link from "next/link"
import { useExtracted } from "next-intl"

export const metadata: Metadata = { title: "Social sharing" }

export default function SocialSharingPage() {
  const t = useExtracted()

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t("Social sharing")}
      </h1>
      <p>
        {t(
          "This page summarizes how friends, circles and groups work. It is information, not a request to share anything. Social features stay unavailable until the eligibility checks for your account have completed."
        )}
      </p>

      <h2>{t("Friends and circles")}</h2>
      <p>
        {t(
          "A friendship requires acceptance from both people. You decide which profile fields friends can see, and can give a circle a narrower or broader field grant. Removing a friend or revoking a grant stops future access. Blocking also prevents new requests and social discovery between the accounts."
        )}
      </p>

      <h2>{t("Groups and classes")}</h2>
      <p>
        {t(
          "Before joining a group, you see its owner, purpose, requested fields, comparison settings and current policy version. Accepting only covers that version. Material policy changes require a new decision before additional data can be used."
        )}
      </p>

      <h2>{t("What other members can see")}</h2>
      <p>
        {t(
          "The profile preview shows the same allow-listed view the selected audience receives. Group members see only the fields and derived statistics authorized by the active policy. They do not receive your complete academic snapshot through the social interface."
        )}
      </p>

      <h2>{t("Your controls")}</h2>
      <ul>
        <li>
          {t("Preview your profile as a friend, circle or group member.")}
        </li>
        <li>{t("Change or revoke a field grant at any time.")}</li>
        <li>{t("Opt into or out of each eligible ranking.")}</li>
        <li>{t("Withdraw group consent or leave a group.")}</li>
        <li>{t("Block an account and report behavior to moderators.")}</li>
      </ul>

      <h2>{t("Learn more")}</h2>
      <p>
        {t(
          "The privacy policy explains retention, account rights and safety records in more detail."
        )}{" "}
        <Link
          href="/legal/privacy"
          className="font-medium text-foreground underline underline-offset-4"
        >
          {t("Read the privacy policy")}
        </Link>
        .
      </p>
    </>
  )
}
