import { runObjectStorageConformance } from "@avermate/agent-contracts/storage-conformance";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3ObjectStorageProvider } from "../../apps/node/src/s3-storage";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`PLAN032_REAL_S3_ENV_REQUIRED:${name}`);
  return value;
}

const root = await mkdtemp(join(tmpdir(), "avermate-plan032-real-s3-"));
try {
  const provider = new S3ObjectStorageProvider({
    id: "node-real-s3-conformance",
    credentials: {
      S3_ENDPOINT: required("PLAN032_REAL_S3_ENDPOINT"),
      S3_REGION: process.env.PLAN032_REAL_S3_REGION ?? "us-east-1",
      S3_BUCKET: required("PLAN032_REAL_S3_BUCKET"),
      S3_ACCESS_KEY_ID: required("PLAN032_REAL_S3_ACCESS_KEY_ID"),
      S3_SECRET_ACCESS_KEY: required("PLAN032_REAL_S3_SECRET_ACCESS_KEY"),
    },
    journalPath: join(root, "journal.json"),
    maxObjectBytes: 1024 * 1024,
    quotaBytes: 16 * 1024 * 1024,
  });
  await provider.initialize();
  const report = await runObjectStorageConformance(provider);
  console.log(
    `[plan-032] opt-in real S3 conformance PASS (${report.passed.join(", ")})`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
