import { adminRouter } from "./admin";
import { announcementsRouter } from "./announcements";
import { averagesRouter } from "./averages";
import { cardsRouter } from "./cards";
import { feedbackRouter } from "./feedback";
import { goalsRouter } from "./goals";
import { gradesRouter } from "./grades";
import { periodsRouter } from "./periods";
import { preferencesRouter } from "./preferences";
import { presetsRouter } from "./presets";
import { profileRouter } from "./profile";
import { publicRouter } from "./public";
import { reviewRouter } from "./review";
import { snapshotRouter } from "./snapshot";
import { subjectsRouter } from "./subjects";
import { yearsRouter } from "./years";

export const appRouter = {
  public: publicRouter,
  snapshot: snapshotRouter,
  years: yearsRouter,
  periods: periodsRouter,
  subjects: subjectsRouter,
  grades: gradesRouter,
  averages: averagesRouter,
  goals: goalsRouter,
  cards: cardsRouter,
  preferences: preferencesRouter,
  profile: profileRouter,
  presets: presetsRouter,
  review: reviewRouter,
  announcements: announcementsRouter,
  feedback: feedbackRouter,
  admin: adminRouter,
};

export type AppRouter = typeof appRouter;
