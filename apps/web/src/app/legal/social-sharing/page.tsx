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
          "This page summarizes how friends and classes work. It is information, not a request to share anything."
        )}
      </p>

      <h2>{t("Friends")}</h2>
      <p>
        {t(
          "A friendship requires acceptance from both people. You decide which profile fields friends can see. Removing a friend stops future access. Blocking also prevents new requests and social discovery between the accounts."
        )}
      </p>

      <h2>{t("Classes")}</h2>
      <p>
        {t(
          "A class uses one shared academic model: its subjects, periods and grading scale. Before joining, you see that model and choose a compatible year or create a separate empty copy from it. Joining never replaces an existing year."
        )}
      </p>

      <h2>{t("What other members can see")}</h2>
      <p>
        {t(
          "Friends see only the profile fields you enabled. Class members see a derived figure only when you turn sharing on for that class. They do not receive your grades or complete academic record."
        )}
      </p>

      <h2>{t("Your controls")}</h2>
      <ul>
        <li>{t("Preview the academic information your friends can see.")}</li>
        <li>{t("Change what friends can see at any time.")}</li>
        <li>{t("Turn class comparison sharing on or off at any time.")}</li>
        <li>{t("Leave a class without deleting the year connected to it.")}</li>
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
