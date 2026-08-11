import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center px-4">
      <section className="max-w-md space-y-5 text-center">
        <p className="numeric text-sm text-muted-foreground">404</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Page introuvable · Page not found
        </h1>
        <p className="text-sm text-muted-foreground">
          Le lien est peut-être ancien. Avermate conserve des redirections pour
          les pages de l’ancienne application lorsque c’est possible.
        </p>
        <Button render={<Link href="/dashboard" />}>
          <ArrowLeftIcon className="size-4" />
          Retour à Avermate
        </Button>
      </section>
    </main>
  )
}
