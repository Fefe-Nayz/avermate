/** Keep post-form navigation inside Avermate and reject protocol-relative URLs. */
export function safeReturnPath(
  value: string | string[] | null | undefined,
  fallback: string
): string {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate?.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : fallback
}
