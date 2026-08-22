import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { jobs } from "../db/schema";
import { NonRetryableJobError, type JobExecutionIdentity } from "../lib/jobs";

export interface UserJobExecutionAuthority extends JobExecutionIdentity {
  userId: string;
}

function authorityError() {
  return new NonRetryableJobError(
    "This job execution is no longer authoritative",
  );
}

/**
 * Re-resolve the durable queue row before any owner-scoped source is read or a
 * provider/grant can be invoked. Callers additionally scope their resource
 * lookup to the returned user id.
 */
export async function requireUserJobExecution(
  identity: JobExecutionIdentity | undefined,
  expectedKind: string,
  payloadMatches: (storedPayload: unknown) => boolean,
): Promise<UserJobExecutionAuthority | undefined> {
  if (!identity) return undefined;
  if (
    identity.kind !== expectedKind ||
    !identity.userId ||
    !Number.isSafeInteger(identity.attempt) ||
    identity.attempt < 1 ||
    !identity.leaseOwner ||
    !identity.runToken
  ) {
    throw authorityError();
  }
  const [job] = await db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, identity.jobId),
        eq(jobs.kind, expectedKind),
        eq(jobs.userId, identity.userId),
        eq(jobs.status, "running"),
        eq(jobs.attempts, identity.attempt),
        eq(jobs.lockedBy, identity.leaseOwner),
        gt(jobs.lockedUntil, new Date()),
      ),
    )
    .limit(1);
  if (!job || !payloadMatches(job.payload)) throw authorityError();
  return identity as UserJobExecutionAuthority;
}

export function supersededJobExecution(): NonRetryableJobError {
  return authorityError();
}

/** Drizzle predicate used again at publication/failure after provider latency. */
export function activeUserJobExecutionSql(
  identity: UserJobExecutionAuthority | undefined,
) {
  if (!identity) return undefined;
  return sql`exists (select 1 from ${jobs} where
    ${jobs.id} = ${identity.jobId} and
    ${jobs.kind} = ${identity.kind} and
    ${jobs.userId} = ${identity.userId} and
    ${jobs.status} = 'running' and
    ${jobs.attempts} = ${identity.attempt} and
    ${jobs.lockedBy} = ${identity.leaseOwner} and
    ${jobs.lockedUntil} is not null and
    ${jobs.lockedUntil} > ${new Date()})`;
}
