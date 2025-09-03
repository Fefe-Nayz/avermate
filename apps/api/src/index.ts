import { type Session, type User } from "@/lib/auth";
import { env } from "@/lib/env";
import { ratelimit } from "@/middlewares/ratelimit";
import { sessionMiddleware } from "@/middlewares/session";
import authRoutes from "@/routes/auth";
import gradesRoutes from "@/routes/grades";
import landingRoutes from "@/routes/landing";
import periodsRoutes from "@/routes/periods";
import presetsRoutes from "@/routes/presets";
import subjectsRoutes from "@/routes/subjects";
import usersRoutes from "@/routes/users";
import averagesRoute from "@/routes/averages";
import feedbackRoute from "@/routes/feedback";
import yearsRoutes from "@/routes/years";
import aiAutoFillRoutes from "@/routes/ai-auto-fill";
import featureFlagsRoutes from "@/routes/feature-flags";
// import cardsRoute from "@/routes/cards";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { uploadHandlers } from "./lib/uploadthing";

const app = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>().basePath("/api");

// Logger
app.use(logger());

// CORS
app.use(
  cors({
    origin: env.CLIENT_URL,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
    credentials: true,
  })
);

// Session
app.use(sessionMiddleware);

// Ratelimit
app.use(ratelimit);

app.route("/auth", authRoutes);

app.route("/grades", gradesRoutes);

app.route("/subjects", subjectsRoutes);

app.route("/periods", periodsRoutes);

app.route("/users", usersRoutes);

app.route("/presets", presetsRoutes);

app.route("/landing", landingRoutes);

app.route("/averages", averagesRoute);

app.route("/feedback", feedbackRoute);

app.route("/years", yearsRoutes);

app.route("/ai-auto-fill", aiAutoFillRoutes);

app.route("/feature-flags", featureFlagsRoutes);

// app.route("/cards", cardsRoute);

if (!env.DISABLE_UPLOADTHING) {
  app.all("/uploadthing", (ctx) => uploadHandlers(ctx.req.raw));
}

export default {
  fetch: app.fetch,
  port: 5000,
};
