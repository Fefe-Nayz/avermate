import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const requiredRunbookSections = [
  "Provider or region outage",
  "Runaway spend or loop",
  "Abuse or denial-of-service pattern",
  "Suspected cross-tenant exposure",
  "Lost, duplicated or conflicting billing webhook",
  "Quota or accounting drift",
  "Stuck deletion or offline node",
  "Backup failure",
  "Regional recovery",
  "Alert catalogue and exercise evidence",
] as const;

const runbook = await Bun.file(
  `${root}/docs/runbooks/managed-operations.md`,
).text();
const managedPlane = await Bun.file(`${root}/docs/managed-plane.md`).text();
const router = await Bun.file(
  `${root}/apps/server/src/routers/managed.ts`,
).text();
const evidence = await Bun.file(
  `${root}/apps/server/src/managed/beta-control-plane.ts`,
).text();
const launchGate = await Bun.file(
  `${root}/scripts/verification/plan-039-launch.ts`,
).text();
const launchContract = await Bun.file(
  `${root}/scripts/verification/plan-039-launch-contract.ts`,
).text();
const sharedEvidenceContract = await Bun.file(
  `${root}/scripts/verification/live-evidence-contract.ts`,
).text();
const launchEvidenceSurface = [
  launchGate,
  launchContract,
  sharedEvidenceContract,
].join("\n");

const failures: string[] = [];
for (const section of requiredRunbookSections) {
  if (
    !runbook.includes(`### ${section}`) &&
    !runbook.includes(`## ${section}`)
  ) {
    failures.push(`missing runbook section: ${section}`);
  }
}
for (const marker of [
  "repository-fixture",
  "deployed-drill",
  "pending_remote_deletion",
  "checkoutEnabled",
]) {
  if (!managedPlane.includes(marker) && !evidence.includes(marker)) {
    failures.push(`missing operational honesty marker: ${marker}`);
  }
}
for (const disabled of [
  "checkoutEnabled: false",
  "billingEnabled: false",
  "launchReady: false",
]) {
  if (!router.includes(disabled))
    failures.push(`missing hard-disabled state: ${disabled}`);
}
if (router.includes("createCheckout:")) {
  failures.push("production checkout procedure exists in the managed router");
}
for (const marker of [
  'git", "rev-parse", "HEAD',
  'git", "status", "--porcelain',
  "schemaVersion !== 2",
  "checkoutDigest",
  "configurationDigest",
  "artifactDigest",
  "environmentDigest",
  "artifactPath",
  "runId",
  "attestor",
  "expiresAt <= now",
  "crossTenantLeaks === 0",
  "networkAttempts === 0",
]) {
  if (!launchEvidenceSurface.includes(marker)) {
    failures.push(`launch evidence is not exact/immutable: ${marker}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Plan 039 operations/runbook honesty contract passed.");
