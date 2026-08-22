import { planningAssignmentsRouter } from "./planning/assignments";
import { planningEventsRouter } from "./planning/events";
import { planningReadRouter } from "./planning/read";
import { planningTasksRouter } from "./planning/tasks";
import { planningTimetableRouter } from "./planning/timetable";

/**
 * Planning v2. The historical `planner` namespace remains available while its
 * rows are backfilled into these purpose-specific aggregates.
 */
export const planningRouter = {
  locate: planningReadRouter.locate,
  calendar: planningReadRouter.calendar,
  day: planningReadRouter.day,
  tasks: planningTasksRouter,
  assignments: planningAssignmentsRouter,
  events: planningEventsRouter,
  timetable: planningTimetableRouter,
};
