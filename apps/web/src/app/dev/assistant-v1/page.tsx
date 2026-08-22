import { notFound } from "next/navigation"
import { AssistantV1Fixture } from "./assistant-v1-fixture"

/** Browser-contract fixture. It renders production assistant components only in dev. */
export default function AssistantV1FixturePage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <AssistantV1Fixture />
}
