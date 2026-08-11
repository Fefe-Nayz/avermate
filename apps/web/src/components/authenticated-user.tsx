"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { AuthenticatedUser } from "@/lib/authenticated-user"

type AuthenticatedUserPatch = Partial<
  Pick<AuthenticatedUser, "name" | "email" | "image">
>

interface AuthenticatedUserContextValue {
  update: (patch: AuthenticatedUserPatch) => void
  user: AuthenticatedUser
}

const AuthenticatedUserContext =
  createContext<AuthenticatedUserContextValue | null>(null)

export function AuthenticatedUserProvider({
  children,
  user,
}: {
  children: ReactNode
  user: AuthenticatedUser
}) {
  const [state, setState] = useState(() => ({ current: user, source: user }))

  // A router refresh can carry updated account fields from the server without
  // recreating this client island because the identity itself did not change.
  if (state.source !== user) {
    setState({ current: user, source: user })
  }

  const update = useCallback((patch: AuthenticatedUserPatch) => {
    setState((previous) => ({
      ...previous,
      current: { ...previous.current, ...patch },
    }))
  }, [])
  const current = state.current
  const value = useMemo(() => ({ update, user: current }), [current, update])

  return (
    <AuthenticatedUserContext.Provider value={value}>
      {children}
    </AuthenticatedUserContext.Provider>
  )
}

export function useAuthenticatedUser(): AuthenticatedUser {
  const value = useContext(AuthenticatedUserContext)
  if (!value) {
    throw new Error(
      "useAuthenticatedUser must be used inside AuthenticatedProviders"
    )
  }
  return value.user
}

export function useUpdateAuthenticatedUser(): (
  patch: AuthenticatedUserPatch
) => void {
  const value = useContext(AuthenticatedUserContext)
  if (!value) {
    throw new Error(
      "useUpdateAuthenticatedUser must be used inside AuthenticatedProviders"
    )
  }
  return value.update
}
