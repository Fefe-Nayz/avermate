import * as React from "react"

export function useMediaQuery(query: string) {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      const result = window.matchMedia(query)
      result.addEventListener("change", onStoreChange)

      return () => result.removeEventListener("change", onStoreChange)
    },
    [query]
  )
  const getSnapshot = React.useCallback(
    () => window.matchMedia(query).matches,
    [query]
  )

  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
