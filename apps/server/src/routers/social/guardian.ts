import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  guardianConsentRequests,
  socialAuditEvents,
  socialEligibility,
  socialFeatureConsents,
  socialFeatureFlags,
} from "../../db/schema";
import { sendGuardianSocialConsentEmail } from "../../lib/email";
import { env } from "../../lib/env";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import {
  SOCIAL_FEATURE_KEY,
  SOCIAL_POLICY_VERSION,
  hashOpaque,
  issueOpaqueToken,
  reserveSocialRateLimit,
} from "../../lib/social-policy";
import { audit, notify } from "./shared";
import { revokeSocialSharing } from "./revocation";

export const socialGuardianRouter = {
  requests: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [eligibility] = await db
      .select({ ageBand: socialEligibility.ageBand })
      .from(socialEligibility)
      .where(eq(socialEligibility.userId, userId))
      .limit(1);
    if (eligibility?.ageBand !== "under15") return [];
    const now = new Date();
    await db
      .update(guardianConsentRequests)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(guardianConsentRequests.childUserId, userId),
          eq(guardianConsentRequests.status, "pending"),
          sql`${guardianConsentRequests.expiresAt} <= ${now}`,
        ),
      );
    return db
      .select({
        id: guardianConsentRequests.id,
        requestCode: guardianConsentRequests.tokenPrefix,
        status: guardianConsentRequests.status,
        policyVersion: guardianConsentRequests.policyVersion,
        expiresAt: guardianConsentRequests.expiresAt,
        respondedAt: guardianConsentRequests.respondedAt,
        createdAt: guardianConsentRequests.createdAt,
      })
      .from(guardianConsentRequests)
      .where(eq(guardianConsentRequests.childUserId, userId))
      .orderBy(desc(guardianConsentRequests.createdAt))
      .limit(20);
  }),

  initiate: protectedProcedure
    .input(z.object({ guardianEmail: z.string().trim().email().max(320) }))
    .handler(async ({ context, input }) => {
      const childUserId = context.session.user.id;
      const normalizedEmail = input.guardianEmail.toLowerCase();
      const [flag, eligibility, childConsent] = await Promise.all([
        db
          .select({ enabled: socialFeatureFlags.enabled })
          .from(socialFeatureFlags)
          .where(eq(socialFeatureFlags.key, SOCIAL_FEATURE_KEY))
          .limit(1)
          .then((rows) => rows[0]),
        db
          .select()
          .from(socialEligibility)
          .where(eq(socialEligibility.userId, childUserId))
          .limit(1)
          .then((rows) => rows[0]),
        db
          .select({ event: socialFeatureConsents.event })
          .from(socialFeatureConsents)
          .where(
            and(
              eq(socialFeatureConsents.userId, childUserId),
              eq(socialFeatureConsents.policyVersion, SOCIAL_POLICY_VERSION),
              eq(socialFeatureConsents.actorType, "child"),
            ),
          )
          .orderBy(desc(socialFeatureConsents.occurredAt))
          .limit(1)
          .then((rows) => rows[0]),
      ]);
      if (!flag?.enabled) {
        throw new ORPCError("FORBIDDEN", {
          message: "The social feature is not enabled",
        });
      }
      if (
        eligibility?.ageBand !== "under15" ||
        childConsent?.event !== "granted"
      ) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Child consent is required before guardian consent",
        });
      }
      if (normalizedEmail === context.session.user.email.toLowerCase()) {
        badRequest("A guardian must use a different verified account");
      }
      await reserveSocialRateLimit({
        subject: childUserId,
        action: "social.guardian.initiate",
        limit: 3,
        windowMs: 86_400_000,
      });
      await reserveSocialRateLimit({
        subject: normalizedEmail,
        action: "social.guardian.target",
        limit: 5,
        windowMs: 86_400_000,
      });
      const issued = issueOpaqueToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1_000);
      const [created] = await db.transaction(async (tx) => {
        await tx
          .update(guardianConsentRequests)
          .set({ status: "revoked", respondedAt: now, updatedAt: now })
          .where(
            and(
              eq(guardianConsentRequests.childUserId, childUserId),
              eq(guardianConsentRequests.status, "pending"),
            ),
          );
        return tx
          .insert(guardianConsentRequests)
          .values({
            childUserId,
            guardianEmailHash: hashOpaque(normalizedEmail),
            tokenHash: issued.tokenHash,
            tokenPrefix: issued.tokenPrefix,
            policyVersion: SOCIAL_POLICY_VERSION,
            expiresAt,
          })
          .returning({
            id: guardianConsentRequests.id,
            status: guardianConsentRequests.status,
            expiresAt: guardianConsentRequests.expiresAt,
          });
      });
      if (!created) badRequest("The guardian request could not be created");
      try {
        await sendGuardianSocialConsentEmail({
          to: normalizedEmail,
          url: `${env.CLIENT_URL}/social/guardian#token=${encodeURIComponent(issued.token)}`,
          requestCode: issued.tokenPrefix,
        });
      } catch (error) {
        await db
          .update(guardianConsentRequests)
          .set({
            status: "revoked",
            respondedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(guardianConsentRequests.id, created.id));
        throw error;
      }
      await audit({
        actorUserId: childUserId,
        action: "guardian.request_created",
        entityType: "guardian_consent_request",
        entityId: created.id,
        changedKeys: ["policyVersion", "expiresAt"],
      });
      return created;
    }),

  preview: protectedProcedure
    .input(z.object({ token: z.string().min(32).max(256) }))
    .handler(async ({ context, input }) => {
      const [request] = await db
        .select({
          id: guardianConsentRequests.id,
          requestCode: guardianConsentRequests.tokenPrefix,
          policyVersion: guardianConsentRequests.policyVersion,
          expiresAt: guardianConsentRequests.expiresAt,
          createdAt: guardianConsentRequests.createdAt,
        })
        .from(guardianConsentRequests)
        .where(
          and(
            eq(guardianConsentRequests.tokenHash, hashOpaque(input.token)),
            eq(
              guardianConsentRequests.guardianEmailHash,
              hashOpaque(context.session.user.email),
            ),
            eq(guardianConsentRequests.status, "pending"),
            eq(guardianConsentRequests.policyVersion, SOCIAL_POLICY_VERSION),
            gt(guardianConsentRequests.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!request) notFound("Guardian request");
      return {
        valid: true as const,
        requestId: request.id,
        requestCode: request.requestCode,
        policyVersion: SOCIAL_POLICY_VERSION as typeof SOCIAL_POLICY_VERSION,
        expiresAt: request.expiresAt,
        createdAt: request.createdAt,
        assurances: {
          emailVerified: true as const,
          requiresAdultAttestation: true as const,
          requiresParentalAuthorityAttestation: true as const,
        },
      };
    }),

  accept: protectedProcedure
    .input(
      z.object({
        token: z.string().min(32).max(256),
        acceptedPolicyVersion: z.literal(SOCIAL_POLICY_VERSION),
        isAdult: z.literal(true),
        hasParentalAuthority: z.literal(true),
      }),
    )
    .handler(async ({ context, input }) => {
      const guardianUserId = context.session.user.id;
      await reserveSocialRateLimit({
        subject: guardianUserId,
        action: "social.guardian.accept",
        limit: 10,
        windowMs: 3_600_000,
      });
      const now = new Date();
      const providerRef = issueOpaqueToken(24).tokenHash;
      let childUserId: string | null = null;
      let requestId: string | null = null;
      await db.transaction(async (tx) => {
        const [feature] = await tx
          .select({ enabled: socialFeatureFlags.enabled })
          .from(socialFeatureFlags)
          .where(eq(socialFeatureFlags.key, SOCIAL_FEATURE_KEY))
          .limit(1);
        if (!feature?.enabled) notFound("Guardian request");
        const [request] = await tx
          .select()
          .from(guardianConsentRequests)
          .where(
            and(
              eq(guardianConsentRequests.tokenHash, hashOpaque(input.token)),
              eq(
                guardianConsentRequests.guardianEmailHash,
                hashOpaque(context.session.user.email),
              ),
              eq(guardianConsentRequests.status, "pending"),
              eq(guardianConsentRequests.policyVersion, SOCIAL_POLICY_VERSION),
              gt(guardianConsentRequests.expiresAt, now),
            ),
          )
          .limit(1);
        if (!request || request.childUserId === guardianUserId)
          notFound("Guardian request");
        const [child] = await tx
          .select({ ageBand: socialEligibility.ageBand })
          .from(socialEligibility)
          .where(eq(socialEligibility.userId, request.childUserId))
          .limit(1);
        const [childConsent] = await tx
          .select({ event: socialFeatureConsents.event })
          .from(socialFeatureConsents)
          .where(
            and(
              eq(socialFeatureConsents.userId, request.childUserId),
              eq(socialFeatureConsents.policyVersion, SOCIAL_POLICY_VERSION),
              eq(socialFeatureConsents.actorType, "child"),
            ),
          )
          .orderBy(desc(socialFeatureConsents.occurredAt))
          .limit(1);
        if (child?.ageBand !== "under15" || childConsent?.event !== "granted") {
          throw new ORPCError("PRECONDITION_FAILED", {
            message: "The child request is no longer eligible",
          });
        }
        const accepted = await tx
          .update(guardianConsentRequests)
          .set({
            status: "accepted",
            respondedAt: now,
            guardianUserId,
            guardianProviderRef: providerRef,
            updatedAt: now,
          })
          .where(
            and(
              eq(guardianConsentRequests.id, request.id),
              eq(guardianConsentRequests.status, "pending"),
              gt(guardianConsentRequests.expiresAt, now),
            ),
          )
          .returning({ id: guardianConsentRequests.id });
        if (accepted.length !== 1) {
          throw new ORPCError("CONFLICT", {
            message: "The guardian request was already handled",
          });
        }
        await tx
          .update(socialEligibility)
          .set({
            assuranceLevel: "guardian_verified",
            providerRef,
            verifiedAt: now,
            expiresAt: new Date(now.getTime() + 365 * 86_400_000),
            updatedAt: now,
          })
          .where(eq(socialEligibility.userId, request.childUserId));
        await tx.insert(socialFeatureConsents).values({
          userId: request.childUserId,
          policyVersion: SOCIAL_POLICY_VERSION,
          actorType: "guardian",
          event: "granted",
          guardianProviderRef: providerRef,
          channel: "web",
        });
        await tx.insert(socialAuditEvents).values({
          actorUserId: guardianUserId,
          subjectUserId: request.childUserId,
          action: "guardian.consent_granted",
          entityType: "guardian_consent_request",
          entityId: request.id,
          changedKeys: JSON.stringify([
            "assuranceLevel",
            "policyVersion",
            "guardianAttestation",
          ]),
        });
        childUserId = request.childUserId;
        requestId = request.id;
      });
      if (childUserId) {
        await notify({
          userId: childUserId,
          actorUserId: guardianUserId,
          kind: "guardian_consent.accepted",
          entityType: "system",
          entityId: requestId,
        });
      }
      return { ok: true };
    }),

  decline: protectedProcedure
    .input(z.object({ token: z.string().min(32).max(256) }))
    .handler(async ({ context, input }) => {
      const now = new Date();
      const [declined] = await db
        .update(guardianConsentRequests)
        .set({
          status: "declined",
          respondedAt: now,
          guardianUserId: context.session.user.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(guardianConsentRequests.tokenHash, hashOpaque(input.token)),
            eq(
              guardianConsentRequests.guardianEmailHash,
              hashOpaque(context.session.user.email),
            ),
            eq(guardianConsentRequests.status, "pending"),
            eq(guardianConsentRequests.policyVersion, SOCIAL_POLICY_VERSION),
            gt(guardianConsentRequests.expiresAt, now),
          ),
        )
        .returning({
          id: guardianConsentRequests.id,
          childUserId: guardianConsentRequests.childUserId,
        });
      if (!declined) notFound("Guardian request");
      await notify({
        userId: declined.childUserId,
        actorUserId: context.session.user.id,
        kind: "guardian_consent.declined",
        entityType: "system",
        entityId: declined.id,
      });
      return { ok: true };
    }),

  revoke: protectedProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [request] = await db
        .select()
        .from(guardianConsentRequests)
        .where(eq(guardianConsentRequests.id, input.requestId))
        .limit(1);
      if (!request) notFound("Guardian request");
      const authorized =
        request.childUserId === userId || request.guardianUserId === userId;
      if (!authorized) notFound("Guardian request");
      const now = new Date();
      await db.transaction(async (tx) => {
        const revoked = await tx
          .update(guardianConsentRequests)
          .set({ status: "revoked", respondedAt: now, updatedAt: now })
          .where(
            and(
              eq(guardianConsentRequests.id, request.id),
              inArray(guardianConsentRequests.status, ["pending", "accepted"]),
            ),
          )
          .returning({ id: guardianConsentRequests.id });
        if (revoked.length !== 1) notFound("Guardian request");
        if (request.status === "accepted" && request.guardianProviderRef) {
          await tx.insert(socialFeatureConsents).values({
            userId: request.childUserId,
            policyVersion: request.policyVersion,
            actorType: "guardian",
            event: "withdrawn",
            guardianProviderRef: request.guardianProviderRef,
            channel: "web",
          });
          await tx
            .update(socialEligibility)
            .set({
              assuranceLevel: "none",
              providerRef: null,
              verifiedAt: null,
              expiresAt: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(socialEligibility.userId, request.childUserId),
                eq(socialEligibility.providerRef, request.guardianProviderRef),
              ),
            );
          await revokeSocialSharing(tx, request.childUserId, now);
        }
        await tx.insert(socialAuditEvents).values({
          actorUserId: userId,
          subjectUserId: request.childUserId,
          action: "guardian.consent_revoked",
          entityType: "guardian_consent_request",
          entityId: request.id,
          changedKeys: JSON.stringify(["status", "assuranceLevel"]),
        });
      });
      return { ok: true };
    }),
};
