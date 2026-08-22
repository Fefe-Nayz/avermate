"use client"

import type { QueryClient } from "@tanstack/react-query"
import { orpc } from "@/lib/orpc"

/**
 * Everything a planning write can have changed.
 *
 * One item shows up in four places — its own list, the month calendar, the day
 * view, and the overview that reads all three — so a write that refreshes only
 * the list it came from leaves the other three showing yesterday. It lived
 * inside the tasks screen, which is why the homework form refreshed a different
 * set from the task form.
 */
export async function invalidatePlanning(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.planning.tasks.list.key() }),
    queryClient.invalidateQueries({
      queryKey: orpc.planning.assignments.list.key(),
    }),
    queryClient.invalidateQueries({ queryKey: orpc.planning.calendar.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.planning.day.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.planning.timetable.key() }),
  ])
}
