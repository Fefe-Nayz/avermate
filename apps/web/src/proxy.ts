import { type NextRequest, NextResponse } from "next/server"
import { REQUEST_PATH_HEADER } from "@/lib/request-path"

/**
 * Preserve the requested protected URL for a server-side authentication
 * redirect. Proxy does not decide whether a user is authenticated; the API's
 * protected oRPC procedure remains the authorization boundary.
 */
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(
    REQUEST_PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  )

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/auth/consent",
    "/announcements/:path*",
    "/dashboard/:path*",
    "/goals/:path*",
    "/grades/:path*",
    "/insights/:path*",
    "/more/:path*",
    "/onboarding/:path*",
    "/review/:path*",
    "/social/:path*",
    "/settings/:path*",
    "/subjects/:path*",
  ],
}
