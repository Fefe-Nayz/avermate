import { adminRouter } from "./admin";
import { announcementsRouter } from "./announcements";
import { academicAdjustmentsRouter } from "./academic-adjustments";
import { averagesRouter } from "./averages";
import { cardTemplatesRouter } from "./card-templates";
import { cardsRouter } from "./cards";
import { connectorsRouter } from "./connectors";
import { documentsRouter } from "./documents";
import { feedbackRouter } from "./feedback";
import { goalsRouter } from "./goals";
import { gradesRouter } from "./grades";
import { jobsRouter } from "./jobs";
import { materialsRouter } from "./materials";
import { periodsRouter } from "./periods";
import { plannerRouter } from "./planner";
import { planningRouter } from "./planning";
import { preferencesRouter } from "./preferences";
import { presetsRouter } from "./presets";
import { profileRouter } from "./profile";
import { publicRouter } from "./public";
import { reviewRouter } from "./review";
import { recordingsRouter } from "./recordings";
import { serviceKeysRouter } from "./service-keys";
import { gradeTypesRouter } from "./grade-types";
import { snapshotRouter } from "./snapshot";
import { socialRouter } from "./social";
import { subjectsRouter } from "./subjects";
import { syncRouter } from "./sync";
import { yearsRouter } from "./years";

export const appRouter = {
  academicAdjustments: academicAdjustmentsRouter,
  public: publicRouter,
  gradeTypes: gradeTypesRouter,
  snapshot: snapshotRouter,
  years: yearsRouter,
  periods: periodsRouter,
  planner: plannerRouter,
  planning: planningRouter,
  subjects: subjectsRouter,
  grades: gradesRouter,
  jobs: jobsRouter,
  materials: materialsRouter,
  averages: averagesRouter,
  goals: goalsRouter,
  cards: cardsRouter,
  connectors: connectorsRouter,
  documents: documentsRouter,
  cardTemplates: cardTemplatesRouter,
  preferences: preferencesRouter,
  profile: profileRouter,
  presets: presetsRouter,
  review: reviewRouter,
  recordings: recordingsRouter,
  serviceKeys: serviceKeysRouter,
  announcements: announcementsRouter,
  feedback: feedbackRouter,
  social: socialRouter,
  sync: syncRouter,
  admin: adminRouter,
};

export type AppRouter = typeof appRouter;
