const INVALID_THREAD_PARAMS = ["thread", "branch", "locator"] as const

export function assistantHrefWithoutInvalidThread(
  pathname: string,
  search: string
): string {
  const params = new URLSearchParams(search)
  for (const key of INVALID_THREAD_PARAMS) params.delete(key)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
