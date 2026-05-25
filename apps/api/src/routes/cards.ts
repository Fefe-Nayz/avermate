// import { db } from "@/db";
// import { cardTemplates, cardLayouts } from "@/db/schema";
// import { type Session, type User } from "@/lib/auth";
// import { zValidator } from "@hono/zod-validator";
// import { and, eq } from "drizzle-orm";
// import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
// import { z } from "zod";

// const app = new Hono<{
//   Variables: {
//     session: {
//       user: User;
//       session: Session;
//     } | null;
//   };
// }>();

// // Schema Definitions
// const cardConfigSchema = z.object({
//   title: z.string(),
//   description: z.object({
//     template: z.string(),
//     variables: z.record(z.object({
//       type: z.enum(['static', 'dynamic', 'timeRange']),
//       value: z.string(),
//       options: z.any().optional(),
//     })),
//   }),
//   mainData: z.object({
//     type: z.enum(['grade', 'average', 'impact', 'text', 'custom']),
//     calculator: z.string(),
//     params: z.any().optional(),
//   }),
//   icon: z.string(),
// });

// const createTemplateSchema = z.object({
//   type: z.enum(['built_in', 'custom']),
//   identifier: z.string().min(1),
//   config: cardConfigSchema,
// });

// const updateLayoutSchema = z.object({
//   page: z.enum(['dashboard', 'grade', 'subject']),
//   cards: z.array(z.object({
//     templateId: z.string(),
//     position: z.number(),
//     customization: z.object({
//       title: z.string().optional(),
//       description: z.object({
//         template: z.string(),
//         variables: z.record(z.any()),
//       }).optional(),
//       mainData: z.object({
//         params: z.record(z.any()),
//       }).optional(),
//     }).optional(),
//   })),
// });

// // Routes
// app.get("/templates", async (c) => {
//   const session = c.get("session");
//   if (!session) throw new HTTPException(401);
//   if (!session.user.emailVerified) {
//     return c.json(
//       { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
//       403
//     );
//   }

//   const templates = await db.query.cardTemplates.findMany({
//     where: and(
//       eq(cardTemplates.type, "built_in"),
//       eq(cardTemplates.userId, session.user.id)
//     ),
//   });

//   return c.json({ templates });
// });

// app.post(
//   "/templates",
//   zValidator("json", createTemplateSchema),
//   async (c) => {
//     const session = c.get("session");
//     if (!session) throw new HTTPException(401);
//     if (!session.user.emailVerified) {
//       return c.json(
//         { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
//         403
//       );
//     }

//     const data = c.req.valid("json");

//     const template = await db
//       .insert(cardTemplates)
//       .values({
//         ...data,
//         config: JSON.stringify(data.config),
//         userId: session.user.id,
//         createdAt: new Date(),
//       })
//       .returning()
//       .get();

//     return c.json({ template }, 201);
//   }
// );

// app.get("/layouts/:page", async (c) => {
//   const session = c.get("session");
//   if (!session) throw new HTTPException(401);
//   if (!session.user.emailVerified) {
//     return c.json(
//       { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
//       403
//     );
//   }

//   const { page } = c.req.param();

//   const layout = await db.query.cardLayouts.findFirst({
//     where: and(
//       eq(cardLayouts.userId, session.user.id),
//       eq(cardLayouts.page, page)
//     ),
//   });

//   return c.json({ layout });
// });

// app.put(
//   "/layouts/:page",
//   zValidator("json", updateLayoutSchema),
//   async (c) => {
//     const session = c.get("session");
//     if (!session) throw new HTTPException(401);
//     if (!session.user.emailVerified) {
//       return c.json(
//         { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
//         403
//       );
//     }

//     const { page } = c.req.param();
//     const data = c.req.valid("json");

//     // Delete existing layout
//     await db
//       .delete(cardLayouts)
//       .where(
//         and(
//           eq(cardLayouts.userId, session.user.id),
//           eq(cardLayouts.page, page)
//         )
//       );

//     // Create new layout
//     const layout = await db
//       .insert(cardLayouts)
//       .values({
//         userId: session.user.id,
//         page,
//         cards: JSON.stringify(data.cards),
//         createdAt: new Date(),
//         updatedAt: new Date(),
//       })
//       .returning()
//       .get();

//     return c.json({ layout });
//   }
// );

// app.delete("/templates/:id", async (c) => {
//   const session = c.get("session");
//   if (!session) throw new HTTPException(401);
//   if (!session.user.emailVerified) {
//     return c.json(
//       { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
//       403
//     );
//   }

//   const { id } = c.req.param();

//   const template = await db
//     .delete(cardTemplates)
//     .where(
//       and(
//         eq(cardTemplates.id, id),
//         eq(cardTemplates.userId, session.user.id),
//         eq(cardTemplates.type, "custom")
//       )
//     )
//     .returning()
//     .get();

//   return c.json({ template });
// });

// export default app;