"use client"

import { useEffect, useRef } from "react"
import { rpc } from "@/lib/orpc/client"

/** Last-resort boundary. It cannot depend on providers from the failed layout. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const reported = useRef(false)

  useEffect(() => {
    if (reported.current) return
    reported.current = true
    const errorDigest = error.digest || "global-boundary"
    const storageKey = `avermate:error:${errorDigest}`
    if (sessionStorage.getItem(storageKey)) return
    sessionStorage.setItem(storageKey, "1")
    void rpc.feedback
      .autoReport({
        source: "web",
        errorDigest,
        route: window.location.pathname,
        appVersion: "web-0.0.1",
        context: { viewport: `${window.innerWidth}×${window.innerHeight}` },
      })
      .catch(() => undefined)
  }, [error.digest])

  return (
    <html lang="fr">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "grid",
          placeItems: "center",
          padding: 24,
          color: "#18181b",
          background: "#fafafa",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: 480, textAlign: "center" }}>
          <h1>Avermate a rencontré un problème</h1>
          <p>
            Vos données sont conservées. Rechargez l’application pour réessayer.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              border: 0,
              borderRadius: 12,
              padding: "0 20px",
              color: "white",
              background: "#18181b",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Réessayer · Try again
          </button>
        </main>
      </body>
    </html>
  )
}
