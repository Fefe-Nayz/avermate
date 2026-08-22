const UNSAFE_ELEMENTS =
  "script,foreignObject,iframe,object,embed,audio,video,form,animate,animateMotion,animateTransform,set"

function safeLocalReference(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === "" || normalized.startsWith("#")
}

/** Strip active/external content from an SVG before it enters the document. */
export function sanitizeGeneratedSvg(svg: SVGSVGElement): SVGSVGElement {
  for (const element of svg.querySelectorAll(UNSAFE_ELEMENTS)) element.remove()
  for (const style of svg.querySelectorAll("style")) {
    if (
      /@import\b|url\s*\(\s*['"]?\s*(?:https?:|\/\/|data:|javascript:)|expression\s*\(/i.test(
        style.textContent ?? ""
      )
    ) {
      style.remove()
    }
  }
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (
        (name === "href" || name === "xlink:href" || name === "src") &&
        !safeLocalReference(value)
      ) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (
        /(?:javascript\s*:|expression\s*\(|url\s*\(\s*['\"]?\s*(?:https?:|\/\/|data:))/i.test(
          value
        )
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  svg.setAttribute("role", "img")
  svg.setAttribute("focusable", "false")
  svg.removeAttribute("height")
  svg.removeAttribute("width")
  svg.style.maxWidth = "100%"
  svg.style.height = "auto"
  return svg
}
