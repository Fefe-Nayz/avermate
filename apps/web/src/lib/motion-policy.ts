export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

export type ActivationSource = "pointer" | "keyboard" | "unknown"

type MotionMediaQueryList = Pick<MediaQueryList, "matches"> &
  Partial<
    Pick<
      MediaQueryList,
      | "addEventListener"
      | "removeEventListener"
      | "addListener"
      | "removeListener"
    >
  >

export type MotionMediaQueryFactory = (
  query: string
) => MotionMediaQueryList | null

export function createReducedMotionStore(
  getMediaQuery: MotionMediaQueryFactory
) {
  const getQuery = () => getMediaQuery(REDUCED_MOTION_QUERY)

  return {
    getSnapshot: () => getQuery()?.matches ?? false,
    getServerSnapshot: () => false,
    subscribe: (onStoreChange: () => void) => {
      const query = getQuery()
      if (!query) return () => undefined

      if (query.addEventListener && query.removeEventListener) {
        query.addEventListener("change", onStoreChange)
        return () => query.removeEventListener?.("change", onStoreChange)
      }

      query.addListener?.(onStoreChange)
      return () => query.removeListener?.(onStoreChange)
    },
  }
}

interface ActivationEventFields {
  readonly detail?: number
  readonly key?: string
  readonly pointerType?: string
}

export function getEventActivationSource(
  event: Event | null | undefined
): ActivationSource {
  if (!event) return "unknown"
  // SAFETY: reads optional discriminating fields off the DOM event; a field
  // absent on this event type stays undefined and falls through to "unknown".
  const eventLike = event as ActivationEventFields
  if (typeof eventLike.key === "string") return "keyboard"
  if (typeof eventLike.pointerType === "string") return "pointer"
  if (typeof eventLike.detail !== "number") return "unknown"
  return eventLike.detail > 0 ? "pointer" : "keyboard"
}

export function shouldAnimateActivation(
  source: ActivationSource,
  reducedMotion: boolean
) {
  return source === "pointer" && !reducedMotion
}

export function dispatchMotionUpdate({
  source,
  reducedMotion,
  update,
  updateInstantly,
}: {
  source: ActivationSource
  reducedMotion: boolean
  update: () => void
  updateInstantly: (update: () => void) => void
}) {
  if (shouldAnimateActivation(source, reducedMotion)) {
    update()
    return "animated" as const
  }

  updateInstantly(update)
  return "instant" as const
}

export interface PageNavigationIntent {
  href: string
  currentHref: string
  source: ActivationSource
  reducedMotion: boolean
  button: number
  defaultPrevented?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  target?: string | null
  download?: boolean
}

export type PageNavigationMode = "animated" | "native"

export function getPageNavigationMode(
  intent: PageNavigationIntent
): PageNavigationMode {
  if (
    intent.defaultPrevented ||
    intent.button !== 0 ||
    intent.altKey ||
    intent.ctrlKey ||
    intent.metaKey ||
    intent.shiftKey ||
    intent.download ||
    (intent.target && intent.target.toLowerCase() !== "_self") ||
    !shouldAnimateActivation(intent.source, intent.reducedMotion)
  ) {
    return "native"
  }

  let currentUrl: URL
  let targetUrl: URL
  try {
    currentUrl = new URL(intent.currentHref)
    targetUrl = new URL(intent.href, currentUrl)
  } catch {
    return "native"
  }

  if (
    targetUrl.origin !== currentUrl.origin ||
    !["http:", "https:"].includes(targetUrl.protocol) ||
    targetUrl.hash ||
    targetUrl.href === currentUrl.href
  ) {
    return "native"
  }

  return "animated"
}
