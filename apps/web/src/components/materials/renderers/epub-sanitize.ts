function externalResource(value: string, dataImagesAllowed: boolean): boolean {
  const normalized = value.trim().toLowerCase()
  if (
    !normalized ||
    normalized.startsWith("#") ||
    normalized.startsWith("blob:")
  ) {
    return false
  }
  if (dataImagesAllowed && normalized.startsWith("data:image/")) return false
  if (normalized.startsWith("//") || normalized.startsWith("/")) return true
  return /^[a-z][a-z0-9+.-]*:/i.test(normalized)
}

function unsafeCss(value: string): boolean {
  return (
    /@import\b/i.test(value) ||
    /url\(\s*["']?\s*(?:https?:|\/\/|javascript:|data:text\/html)/i.test(
      value
    ) ||
    /expression\s*\(/i.test(value)
  )
}

const EPUB_CONTENT_POLICY = [
  "default-src 'none'",
  "img-src blob: data:",
  "media-src blob: data:",
  "font-src blob: data:",
  "style-src 'unsafe-inline' blob:",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
].join("; ")

/**
 * Defence in depth on top of epub.js' sandboxed, script-free iframe.
 *
 * Books may contain active elements and CSS URLs. Removing them before a
 * chapter is displayed ensures that opening a local archive cannot silently
 * contact an origin selected by its author.
 */
export function sanitizeEpubDocument(document: Document): void {
  for (const element of document.querySelectorAll(
    "script, iframe, frame, object, embed, form, base, meta[http-equiv]"
  )) {
    element.remove()
  }

  for (const element of document.querySelectorAll("style")) {
    if (unsafeCss(element.textContent ?? "")) element.remove()
  }

  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value
      if (name.startsWith("on") || name === "srcset") {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === "style" && unsafeCss(value)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (
        (name === "href" || name === "xlink:href" || name === "action") &&
        externalResource(value, false)
      ) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (
        (name === "src" || name === "poster" || name === "data") &&
        externalResource(value, name === "src")
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  const head = document.querySelector("head")
  if (head) {
    const policy = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "meta"
    )
    policy.setAttribute("http-equiv", "Content-Security-Policy")
    policy.setAttribute("content", EPUB_CONTENT_POLICY)
    head.prepend(policy)
  }
}
