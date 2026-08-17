/**
 * Copy text, including where `navigator.clipboard` does not exist.
 *
 * The Async Clipboard API is a secure-context feature, exactly like
 * `crypto.randomUUID`. `localhost` is a secure context and a phone opening the
 * same dev server at `http://192.168.1.29:3000` is not, so `navigator.clipboard`
 * is `undefined` there and every call site throws on the property access before
 * it ever reaches `writeText`.
 *
 * `document.execCommand("copy")` is deprecated and still the only thing that
 * works there, so it is the fallback rather than the primary. It has to act on a
 * real selection in the document, hence the off-screen textarea.
 *
 * Returns whether the text was copied, so a caller can tell the difference
 * between "copied" and "nothing happened" rather than claiming success.
 */
export async function copyText(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Denied permission, or a browser that exposes the API and refuses it.
      // Fall through rather than give up.
    }
  }

  if (typeof document === "undefined") return false

  const holder = document.createElement("textarea")
  holder.value = value
  // Off-screen rather than hidden: a `display: none` element cannot be
  // selected, and `readOnly` stops iOS opening the keyboard for it.
  holder.setAttribute("readonly", "")
  holder.style.position = "fixed"
  holder.style.top = "-9999px"
  holder.style.opacity = "0"
  document.body.appendChild(holder)

  try {
    holder.select()
    holder.setSelectionRange(0, value.length)
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    holder.remove()
  }
}
