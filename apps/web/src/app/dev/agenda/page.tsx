import { notFound } from "next/navigation"
import { AgendaConcepts } from "./agenda-concepts"

/** Agenda skins, side by side, outside the authenticated tree. Development only. */
export default function DevAgendaRoute() {
  if (process.env.NODE_ENV === "production") notFound()
  return <AgendaConcepts />
}
