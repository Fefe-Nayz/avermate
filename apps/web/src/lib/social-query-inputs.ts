export const INITIAL_SOCIAL_NOTIFICATIONS_INPUT = {
  unreadOnly: false,
  limit: 50,
  offset: 0,
} as const

export function socialNotificationsInput(unreadOnly: boolean) {
  return { unreadOnly, limit: 50, offset: 0 } as const
}
