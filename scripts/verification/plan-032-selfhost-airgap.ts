import {
  assertSelfHostSourceIsolation,
  withFullSelfHost,
} from "./plan-032-compose-runtime";
import { composeConfig, requireDockerDaemon } from "./plan-032-lib";

await assertSelfHostSourceIsolation();
await composeConfig("full-self-host");

if (process.argv.includes("--static-only")) {
  console.warn(
    "[plan-032] static-only requested: air-gap runtime proof is NOT proven.",
  );
  process.exit(0);
}

await requireDockerDaemon();

await withFullSelfHost({
  label: "full-self-host-airgap",
  verifyEgressBoundary: true,
});

console.log(
  "[plan-032] air-gap proof passed: internal-only runtime network, real Core/Web smoke, hosted bundle scan, DNS and HTTP egress denial",
);
