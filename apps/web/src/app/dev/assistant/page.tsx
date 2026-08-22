import { notFound } from "next/navigation"
import { AssistantSpikeClient } from "@/components/assistant-spike/assistant-spike-client"

/** Authenticated API proof surface; the route itself exists only in development. */
export default function DevAssistantRoute() {
  if (process.env.NODE_ENV === "production") notFound()
  return <AssistantSpikeClient />
}
