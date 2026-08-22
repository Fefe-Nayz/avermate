/**
 * Which screens own the whole pane.
 *
 * Almost every screen here is a document: one column of content, centred at
 * `max-w-6xl`, that scrolls as a page. A file browser is not a document. It is
 * two panes that scroll independently inside a frame that does not move, and
 * squeezing one into a centred column with page gutters is what made Materials
 * read as a widget dropped onto a page rather than a place you are in.
 *
 * Decided from the path rather than declared by the page: the shell renders
 * before the page does, so a page that announced this through context would
 * paint narrow for one frame and then jump.
 */
const FULL_BLEED_ROUTES: readonly string[] = ["/materials", "/assistant"]

/** Trailing slashes are the same route; a sub-route is not. */
function normalise(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/"))
    return pathname.slice(0, -1)
  return pathname
}

export function isFullBleedRoute(pathname: string): boolean {
  return FULL_BLEED_ROUTES.includes(normalise(pathname))
}
