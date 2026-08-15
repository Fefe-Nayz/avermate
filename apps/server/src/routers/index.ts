import { adminRouter } from "./admin";
import { announcementsRouter } from "./announcements";
import { averagesRouter } from "./averages";
import { cardTemplatesRouter } from "./card-templates";
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
import { socialRouter } from "./social";
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
  cardTemplates: cardTemplatesRouter,
  preferences: preferencesRouter,
  profile: profileRouter,
  presets: presetsRouter,
  review: reviewRouter,
  announcements: announcementsRouter,
  feedback: feedbackRouter,
  social: socialRouter,
  admin: adminRouter,
};

export type AppRouter = typeof appRouter;
