/** The non-sensitive account fields shared with authenticated client islands. */
export interface AuthenticatedUser {
  id: string
  name: string
  email: string
  image: string | null
  createdAt: string
}
