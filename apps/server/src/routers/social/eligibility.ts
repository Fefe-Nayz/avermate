import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  socialAuditEvents,
  socialEligibility,
  socialFeatureConsents,
  socialFeatureFlags,
  socialProfiles,
} from "../../db/schema";
import { protectedProcedure } from "../../lib/orpc";
import {
  SOCIAL_FEATURE_KEY,
  SOCIAL_POLICY_VERSION,
  reserveSocialRateLimit,
} from "../../lib/social-policy";
import { channelSchema, eligibilityView } from "./shared";
import { revokeSocialSharing } from "./revocation";

export const socialEligibilityRouter = {
  get: protectedProcedure.handler(({ context }) =>
    eligibilityView(context.session.user.id),
  ),

  begin: protectedProcedure
    .input(
      z.object({
        ageBand: z.enum(["under15", "15to17", "adult"]),
        channel: channelSchema,
        acceptedPolicyVersion: z.literal(SOCIAL_POLICY_VERSION),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [flag] = await db
        .select({ enabled: socialFeatureFlags.enabled })
        .from(socialFeatureFlags)
        .where(eq(socialFeatureFlags.key, SOCIAL_FEATURE_KEY))
        .limit(1);
      if (!flag?.enabled) {
        throw new ORPCError("FORBIDDEN", {
          message: "The social feature is not enabled",
        });
      }
      await reserveSocialRateLimit({
        subject: userId,
        action: "social.eligibility.begin",
        limit: 5,
        windowMs: 60 * 60 * 1_000,
      });
      const now = new Date();
      await db.transaction(async (tx) => {
        const [existingEligibility] = await tx
          .select({ ageBand: socialEligibility.ageBand })
          .from(socialEligibility)
          .where(eq(socialEligibility.userId, userId))
          .limit(1);
        if (
          existingEligibility &&
          existingEligibility.ageBand !== "unknown" &&
          existingEligibility.ageBand !== input.ageBand
        ) {
          throw new ORPCError("CONFLICT", {
            message:
              "Changing an established age band requires a reviewed eligibility flow",
          });
        }
        await tx
          .insert(socialEligibility)
          .values({
            userId,
            ageBand: input.ageBand,
            assuranceLevel:
              input.ageBand === "under15" ? "none" : "self_declared",
            providerRef: null,
            verifiedAt: input.ageBand === "under15" ? null : now,
            expiresAt: null,
          })
          .onConflictDoUpdate({
            target: socialEligibility.userId,
            set: {
              ageBand: input.ageBand,
              assuranceLevel:
                input.ageBand === "under15" ? "none" : "self_declared",
              providerRef: null,
              verifiedAt: input.ageBand === "under15" ? null : now,
              expiresAt: null,
              updatedAt: now,
            },
          });
        await tx.insert(socialFeatureConsents).values({
          userId,
          policyVersion: SOCIAL_POLICY_VERSION,
          actorType: input.ageBand === "under15" ? "child" : "user",
          event: "granted",
          channel: input.channel,
        });
        await tx
          .insert(socialProfiles)
          .values({
            userId,
            displayName: context.session.user.name,
            status: "off",
          })
          .onConflictDoNothing({ target: socialProfiles.userId });
        await tx.insert(socialAuditEvents).values({
          actorUserId: userId,
          subjectUserId: userId,
          action: "eligibility.consent_granted",
          entityType: "social_eligibility",
          entityId: userId,
          changedKeys: JSON.stringify(["ageBand", "policyVersion"]),
        });
      });
      return eligibilityView(userId);
    }),

  revoke: protectedProcedure
    .input(z.object({ channel: channelSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const view = await eligibilityView(userId);
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(socialFeatureConsents).values({
          userId,
          policyVersion: SOCIAL_POLICY_VERSION,
          actorType: view.ageBand === "under15" ? "child" : "user",
          event: "withdrawn",
          channel: input.channel,
        });
        await revokeSocialSharing(tx, userId, now);
        await tx.insert(socialAuditEvents).values({
          actorUserId: userId,
          subjectUserId: userId,
          action: "eligibility.consent_withdrawn",
          entityType: "social_eligibility",
          entityId: userId,
          changedKeys: JSON.stringify(["consent", "profileStatus"]),
        });
      });
      return eligibilityView(userId);
    }),
};
